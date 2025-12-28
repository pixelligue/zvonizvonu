'use client';

import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Peer, { MediaConnection } from 'peerjs';
import { useMicrophone } from '@/hooks/useMicrophone';
import { useRecorder } from '@/hooks/useRecorder';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MicLevel } from '@/components/MicLevel';
import { ControlButton, Toggle, ScreenViewer, SFURoom } from '@/components/room';
import { MicIcon, MicOffIcon, PhoneOffIcon, LinkIcon, ScreenIcon, RecordIcon } from '@/components/icons';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
const PEER_HOST = process.env.NEXT_PUBLIC_PEER_HOST || 'localhost';
const PEER_PORT = Number(process.env.NEXT_PUBLIC_PEER_PORT) || 5006;
const PEER_SECURE = process.env.NEXT_PUBLIC_PEER_SECURE === 'true';

type Status = 'setup' | 'waiting' | 'pending' | 'connected' | 'error';

interface PendingUser { peerId: string; name: string; }
interface Participant { peerId: string; name: string; isHost: boolean; }
interface RoomSettings { screenShareEnabled: boolean; recordingAllowed: string[]; }
interface PeerStatus { isMuted: boolean; audioLevel: number; }

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();
  const isHost = searchParams.get('host') === 'true';
  const isSFU = searchParams.get('sfu') === 'true';

  // Если режим SFU — используем отдельный компонент
  if (isSFU) {
    return <SFURoomWrapper code={code} isHost={isHost} />;
  }

  return <MeshRoom code={code} isHost={isHost} />;
}

// Wrapper для SFU режима
function SFURoomWrapper({ code, isHost }: { code: string; isHost: boolean }) {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f7] p-4 md:p-8">
      <div className="flex flex-col items-center gap-6 w-full max-w-2xl">
        <div className="text-center">
          <p className="text-gray-500 text-sm mb-1">Комната</p>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-[0.2em] font-mono">{code}</h1>
        </div>
        <SFURoom code={code} isHost={isHost} onLeave={() => router.push('/')} />
      </div>
    </div>
  );
}

// Mesh режим (оригинальная реализация)
function MeshRoom({ code, isHost }: { code: string; isHost: boolean }) {
  const router = useRouter();

  const [status, setStatus] = useState<Status>('setup');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [peersCount, setPeersCount] = useState(0);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<RoomSettings>({ screenShareEnabled: false, recordingAllowed: [] });
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [peerStatuses, setPeerStatuses] = useState<Map<string, PeerStatus>>(new Map());

  // Screen share state
  const [isSharing, setIsSharing] = useState(false);
  const [remoteScreen, setRemoteScreen] = useState<MediaStream | null>(null);

  const mic = useMicrophone();
  const recorder = useRecorder();
  const isMobile = useIsMobile();

  const peerRef = useRef<Peer | null>(null);
  const callsRef = useRef<Map<string, MediaConnection>>(new Map());
  const screenCallsRef = useRef<Map<string, MediaConnection>>(new Map());
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const connectedPeersRef = useRef<Set<string>>(new Set());
  const dataConnectionsRef = useRef<Map<string, import('peerjs').DataConnection>>(new Map());
  const audioAnalyzersRef = useRef<Map<string, { analyser: AnalyserNode; ctx: AudioContext }>>(new Map());
  const audioLevelIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Memoized computed values
  const canRecord = useMemo(
    () => isHost || (myPeerId && settings.recordingAllowed.includes(myPeerId)),
    [isHost, myPeerId, settings.recordingAllowed]
  );

  const canShareScreen = useMemo(
    () => !isMobile && (isHost || settings.screenShareEnabled),
    [isMobile, isHost, settings.screenShareEnabled]
  );

  const showControls = useMemo(
    () => status === 'waiting' || status === 'connected',
    [status]
  );

  // Callbacks
  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/rooms/${code}/settings`);
      if (res.ok) setSettings(await res.json());
    } catch {}
  }, [code]);

  const fetchParticipants = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/rooms/${code}/participants`);
      if (res.ok) {
        const data = await res.json();
        setParticipants(data.participants || []);
      }
    } catch {}
  }, [code]);

  // Setup audio analyzer for a remote stream
  const setupAudioAnalyzer = useCallback((peerId: string, stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioAnalyzersRef.current.set(peerId, { analyser, ctx });
    } catch (e) {
      console.error('Failed to setup audio analyzer:', e);
    }
  }, []);

  // Cleanup audio analyzer
  const cleanupAudioAnalyzer = useCallback((peerId: string) => {
    const entry = audioAnalyzersRef.current.get(peerId);
    if (entry) {
      entry.ctx.close();
      audioAnalyzersRef.current.delete(peerId);
    }
  }, []);

  // Broadcast mute status to all peers
  const broadcastMuteStatus = useCallback((isMuted: boolean) => {
    dataConnectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'mute-status', isMuted });
      }
    });
  }, []);

  // Handle incoming data from peers
  const handlePeerData = useCallback((peerId: string, data: unknown) => {
    if (typeof data === 'object' && data !== null && 'type' in data) {
      const msg = data as { type: string; isMuted?: boolean };
      if (msg.type === 'mute-status' && typeof msg.isMuted === 'boolean') {
        setPeerStatuses(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(peerId) || { isMuted: false, audioLevel: 0 };
          newMap.set(peerId, { ...existing, isMuted: msg.isMuted! });
          return newMap;
        });
      }
    }
  }, []);

  // Setup data connection with a peer
  const setupDataConnection = useCallback((peerId: string) => {
    if (!peerRef.current || dataConnectionsRef.current.has(peerId)) return;

    const conn = peerRef.current.connect(peerId);
    conn.on('open', () => {
      dataConnectionsRef.current.set(peerId, conn);
      // Send our current mute status
      conn.send({ type: 'mute-status', isMuted: mic.isMuted });
    });
    conn.on('data', (data) => handlePeerData(peerId, data));
    conn.on('close', () => {
      dataConnectionsRef.current.delete(peerId);
    });
  }, [mic.isMuted, handlePeerData]);

  const toggleScreenSharePermission = useCallback(async () => {
    const newValue = !settings.screenShareEnabled;
    await fetch(`${API_URL}/api/rooms/${code}/screen-share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newValue }),
    });
    setSettings(s => ({ ...s, screenShareEnabled: newValue }));
  }, [code, settings.screenShareEnabled]);

  const sendScreenToPeer = useCallback((peerId: string, stream: MediaStream) => {
    if (!peerRef.current || screenCallsRef.current.has(peerId)) return;

    const call = peerRef.current.call(peerId, stream, { metadata: { type: 'screen' } });
    call.on('close', () => screenCallsRef.current.delete(peerId));
    screenCallsRef.current.set(peerId, call);
  }, []);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    screenCallsRef.current.forEach(call => call.close());
    screenCallsRef.current.clear();
    setIsSharing(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = stream;
      setIsSharing(true);

      connectedPeersRef.current.forEach(peerId => {
        sendScreenToPeer(peerId, stream);
      });

      stream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch {
      console.error('Screen share failed');
    }
  }, [sendScreenToPeer, stopScreenShare]);

  const handleScreenCall = useCallback((call: MediaConnection) => {
    call.answer();

    call.on('stream', (stream) => {
      setRemoteScreen(stream);
    });

    call.on('close', () => {
      setRemoteScreen(null);
    });
  }, []);

  const handleAudioCall = useCallback((call: MediaConnection) => {
    if (!mic.stream) return;

    // Prevent duplicate connections - if we already have a call to this peer, ignore incoming
    if (callsRef.current.has(call.peer)) {
      console.log('Already have connection to', call.peer, '- ignoring incoming call');
      return;
    }

    call.answer(mic.stream);

    call.on('stream', (remoteStream) => {
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      // Explicitly play to handle browsers that block autoplay
      audio.play().catch(e => console.warn('Audio autoplay blocked:', e));
      audioRefs.current.set(call.peer, audio);
      remoteStreamsRef.current.set(call.peer, remoteStream);
      connectedPeersRef.current.add(call.peer);
      setPeersCount(connectedPeersRef.current.size);
      setupAudioAnalyzer(call.peer, remoteStream);

      if (screenStreamRef.current) {
        sendScreenToPeer(call.peer, screenStreamRef.current);
      }
    });

    call.on('close', () => {
      audioRefs.current.get(call.peer)?.pause();
      audioRefs.current.delete(call.peer);
      remoteStreamsRef.current.delete(call.peer);
      connectedPeersRef.current.delete(call.peer);
      callsRef.current.delete(call.peer);
      cleanupAudioAnalyzer(call.peer);
      setPeersCount(connectedPeersRef.current.size);
    });

    callsRef.current.set(call.peer, call);
  }, [mic.stream, sendScreenToPeer, setupAudioAnalyzer, cleanupAudioAnalyzer]);

  const handleCall = useCallback((call: MediaConnection) => {
    const metadata = call.metadata as { type?: string } | undefined;
    if (metadata?.type === 'screen') {
      handleScreenCall(call);
    } else {
      handleAudioCall(call);
    }
  }, [handleAudioCall, handleScreenCall]);

  const callPeer = useCallback((peerId: string) => {
    if (!peerRef.current || !mic.stream || callsRef.current.has(peerId)) return;

    const myId = peerRef.current.id;
    // Deterministic ordering: only the peer with the "smaller" ID initiates the call
    // This prevents race conditions where both peers try to call each other
    if (myId > peerId) {
      console.log('Skipping call to', peerId, '- they should call us (deterministic ordering)');
      return;
    }

    const call = peerRef.current.call(peerId, mic.stream, { metadata: { type: 'audio' } });

    call.on('stream', (remoteStream) => {
      const audio = new Audio();
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      // Explicitly play to handle browsers that block autoplay
      audio.play().catch(e => console.warn('Audio autoplay blocked:', e));
      audioRefs.current.set(peerId, audio);
      remoteStreamsRef.current.set(peerId, remoteStream);
      connectedPeersRef.current.add(peerId);
      setPeersCount(connectedPeersRef.current.size);
      setupAudioAnalyzer(peerId, remoteStream);
      setupDataConnection(peerId);
    });

    call.on('close', () => {
      audioRefs.current.get(peerId)?.pause();
      audioRefs.current.delete(peerId);
      remoteStreamsRef.current.delete(peerId);
      connectedPeersRef.current.delete(peerId);
      callsRef.current.delete(peerId);
      cleanupAudioAnalyzer(peerId);
      dataConnectionsRef.current.get(peerId)?.close();
      dataConnectionsRef.current.delete(peerId);
      setPeersCount(connectedPeersRef.current.size);
    });

    callsRef.current.set(peerId, call);
  }, [mic.stream, setupAudioAnalyzer, cleanupAudioAnalyzer, setupDataConnection]);

  const approveUser = useCallback(async (peerId: string) => {
    await fetch(`${API_URL}/api/rooms/${code}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId }),
    });
    setPendingUsers(p => p.filter(u => u.peerId !== peerId));
    callPeer(peerId);
  }, [code, callPeer]);

  const rejectUser = useCallback(async (peerId: string) => {
    await fetch(`${API_URL}/api/rooms/${code}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId }),
    });
    setPendingUsers(p => p.filter(u => u.peerId !== peerId));
  }, [code]);

  const handleLeave = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (recorder.isRecording) recorder.stopRecording();
    stopScreenShare();
    audioRefs.current.forEach(a => { a.pause(); a.srcObject = null; });
    callsRef.current.forEach(c => c.close());
    if (peerRef.current?.id) {
      fetch(`${API_URL}/api/rooms/${code}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: peerRef.current.id }),
      });
    }
    peerRef.current?.destroy();
    mic.stopMic();
    router.push('/');
  }, [code, recorder, stopScreenShare, mic, router]);

  const handleStart = useCallback(async () => {
    if (!mic.stream) { await mic.startMic(); return; }
    if (!isHost && !name.trim()) return;

    const peer = new Peer({
      host: PEER_HOST,
      port: PEER_PORT,
      path: '/peerjs',
      secure: PEER_SECURE,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
          { urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
        ]
      }
    });
    peerRef.current = peer;

    peer.on('open', async (id) => {
      setMyPeerId(id);
      if (isHost) {
        await fetch(`${API_URL}/api/rooms/${code}/host`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: id, name: 'Хост' }),
        });
        setStatus('waiting');
        await fetchParticipants();
        pollRef.current = setInterval(async () => {
          const res = await fetch(`${API_URL}/api/rooms/${code}/pending`);
          const data = await res.json();
          setPendingUsers(data.pending);
          await fetchSettings();
          await fetchParticipants();
        }, 2000);
      } else {
        await fetch(`${API_URL}/api/rooms/${code}/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: id, name: name.trim() }),
        });
        setStatus('pending');
        pollRef.current = setInterval(async () => {
          const res = await fetch(`${API_URL}/api/rooms/${code}`);
          const data = await res.json();
          if (data.peers.includes(id)) {
            clearInterval(pollRef.current!);
            setStatus('connected');
            setSettings({ screenShareEnabled: data.screenShareEnabled, recordingAllowed: data.recordingAllowed });
            data.peers.filter((p: string) => p !== id).forEach(callPeer);
            setParticipants(data.participants || []);
            pollRef.current = setInterval(async () => {
              await fetchSettings();
              await fetchParticipants();
            }, 3000);
          }
        }, 2000);
      }
    });

    peer.on('call', handleCall);
    peer.on('error', () => { setError('Ошибка соединения'); setStatus('error'); });
  }, [mic, isHost, name, code, fetchSettings, fetchParticipants, callPeer, handleCall]);

  const toggleRecording = useCallback(() => {
    if (recorder.isRecording) {
      recorder.stopRecording();
    } else if (mic.stream) {
      recorder.startRecording(mic.stream, Array.from(remoteStreamsRef.current.values()));
    }
  }, [recorder.isRecording, recorder.stopRecording, recorder.startRecording, mic.stream]);

  const toggleScreenShare = useCallback(() => {
    if (isSharing) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [isSharing, stopScreenShare, startScreenShare]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
  }, []);

  const goHome = useCallback(() => {
    router.push('/');
  }, [router]);

  // Audio level monitoring
  useEffect(() => {
    if (status !== 'waiting' && status !== 'connected') return;

    audioLevelIntervalRef.current = setInterval(() => {
      const updates = new Map<string, PeerStatus>();

      audioAnalyzersRef.current.forEach((entry, peerId) => {
        const dataArray = new Uint8Array(entry.analyser.frequencyBinCount);
        entry.analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const level = Math.min(100, Math.round(avg * 1.5));

        const existing = peerStatuses.get(peerId) || { isMuted: false, audioLevel: 0 };
        updates.set(peerId, { ...existing, audioLevel: level });
      });

      if (updates.size > 0) {
        setPeerStatuses(prev => {
          const newMap = new Map(prev);
          updates.forEach((value, key) => newMap.set(key, value));
          return newMap;
        });
      }
    }, 100);

    return () => {
      if (audioLevelIntervalRef.current) {
        clearInterval(audioLevelIntervalRef.current);
      }
    };
  }, [status, peerStatuses]);

  // Broadcast mute status when it changes
  useEffect(() => {
    broadcastMuteStatus(mic.isMuted);
  }, [mic.isMuted, broadcastMuteStatus]);

  // Handle incoming data connections
  useEffect(() => {
    if (!peerRef.current) return;

    const handleConnection = (conn: import('peerjs').DataConnection) => {
      conn.on('open', () => {
        dataConnectionsRef.current.set(conn.peer, conn);
        // Send our current mute status
        conn.send({ type: 'mute-status', isMuted: mic.isMuted });
      });
      conn.on('data', (data) => handlePeerData(conn.peer, data));
      conn.on('close', () => {
        dataConnectionsRef.current.delete(conn.peer);
      });
    };

    peerRef.current.on('connection', handleConnection);

    return () => {
      peerRef.current?.off('connection', handleConnection);
    };
  }, [mic.isMuted, handlePeerData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (audioLevelIntervalRef.current) clearInterval(audioLevelIntervalRef.current);
      audioAnalyzersRef.current.forEach(entry => entry.ctx.close());
      dataConnectionsRef.current.forEach(conn => conn.close());
    };
  }, []);

  // Memoized icons for control buttons
  const micButtonIcon = useMemo(
    () => mic.isMuted ? <MicOffIcon /> : <MicIcon />,
    [mic.isMuted]
  );

  const screenButtonIcon = useMemo(() => <ScreenIcon />, []);
  const recordButtonIcon = useMemo(() => <RecordIcon />, []);
  const phoneOffButtonIcon = useMemo(() => <PhoneOffIcon />, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f7] p-4 md:p-8">
      <div className="flex flex-col items-center gap-6 w-full max-w-2xl">
        <div className="text-center">
          <p className="text-gray-500 text-sm mb-1">Комната</p>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-[0.2em] font-mono">{code}</h1>
        </div>

        {/* Remote Screen */}
        {remoteScreen && <ScreenViewer stream={remoteScreen} />}

        {/* Setup */}
        {status === 'setup' && (
          <div className="w-full max-w-sm bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-8 space-y-6">
            <p className="text-center text-gray-600">{isHost ? 'Вы создаёте комнату' : 'Вы присоединяетесь'}</p>
            {!mic.stream ? (
              <button onClick={mic.startMic} className="w-full py-4 bg-[#007AFF] hover:bg-[#0066d6] text-white text-lg font-medium rounded-2xl transition-all active:scale-[0.98]">
                Разрешить микрофон
              </button>
            ) : (
              <>
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
                    <MicLevel level={mic.level} isMuted={mic.isMuted} />
                  </div>
                  <p className="text-green-600 text-sm font-medium">Микрофон работает</p>
                </div>
                {!isHost && (
                  <input
                    type="text"
                    value={name}
                    onChange={handleNameChange}
                    placeholder="Ваше имя"
                    className="w-full py-4 px-5 bg-gray-100 text-gray-900 placeholder-gray-400 rounded-2xl border-0 focus:ring-2 focus:ring-[#007AFF] focus:outline-none"
                  />
                )}
                <button
                  onClick={handleStart}
                  disabled={!isHost && !name.trim()}
                  className="w-full py-4 bg-[#34C759] hover:bg-[#2db84d] disabled:bg-gray-200 text-white text-lg font-medium rounded-2xl transition-all active:scale-[0.98]"
                >
                  {isHost ? 'Начать' : 'Запросить вход'}
                </button>
              </>
            )}
            {mic.error && <p className="text-red-500 text-center text-sm">{mic.error}</p>}
          </div>
        )}

        {/* Waiting / Connected */}
        {showControls && (
          <div className="w-full max-w-sm space-y-4">
            <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-6 flex flex-col items-center gap-4">
              <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center shadow-lg">
                <MicLevel level={mic.level} isMuted={mic.isMuted} light />
              </div>
              <p className={status === 'connected' ? 'text-green-600 font-medium' : 'text-gray-500'}>
                {status === 'connected' ? `Подключено (${peersCount})` : 'Ожидание участников...'}
              </p>
              {recorder.isRecording && (
                <div className="flex items-center gap-2 text-red-500 text-sm">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  Запись {recorder.formattedDuration}
                </div>
              )}
              {isSharing && (
                <div className="flex items-center gap-2 text-blue-500 text-sm">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  Вы демонстрируете экран
                </div>
              )}
              <button onClick={copyLink} className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-full text-sm text-gray-700 transition-colors">
                <LinkIcon />
                {copied ? 'Скопировано!' : 'Скопировать ссылку'}
              </button>
            </div>

            {/* Host settings */}
            {isHost && (
              <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-6 space-y-4">
                <p className="text-gray-500 text-sm font-medium">Настройки</p>
                <label className="flex items-center justify-between">
                  <span className="text-gray-700 text-sm">Демонстрация для всех</span>
                  <Toggle checked={settings.screenShareEnabled} onChange={toggleScreenSharePermission} />
                </label>
              </div>
            )}

            {/* Participants list */}
            {participants.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-6 space-y-3">
                <p className="text-gray-500 text-sm font-medium">Участники ({participants.length})</p>
                <div className="space-y-2">
                  {participants.map(p => (
                    <ParticipantRow
                      key={p.peerId}
                      participant={p}
                      isMe={p.peerId === myPeerId}
                      status={p.peerId === myPeerId
                        ? { isMuted: mic.isMuted, audioLevel: mic.level }
                        : peerStatuses.get(p.peerId)
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Pending users */}
            {pendingUsers.length > 0 && (
              <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-6 space-y-3">
                <p className="text-gray-500 text-sm">Запросы на вход</p>
                {pendingUsers.map(u => (
                  <PendingUserRow
                    key={u.peerId}
                    user={u}
                    onApprove={approveUser}
                    onReject={rejectUser}
                  />
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex justify-center gap-3">
              <ControlButton onClick={mic.toggleMute} active={!mic.isMuted} icon={micButtonIcon} color="gray" />
              {canShareScreen && (
                <ControlButton onClick={toggleScreenShare} active={isSharing} icon={screenButtonIcon} color="blue" />
              )}
              {canRecord && (
                <ControlButton onClick={toggleRecording} active={recorder.isRecording} icon={recordButtonIcon} color="red" />
              )}
              <ControlButton onClick={handleLeave} active icon={phoneOffButtonIcon} color="red" />
            </div>
          </div>
        )}

        {/* Pending */}
        {status === 'pending' && (
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-8 flex flex-col items-center gap-6">
            <div className="w-16 h-16 border-4 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600">Ожидание одобрения...</p>
            <button onClick={handleLeave} className="text-gray-400 hover:text-gray-600 text-sm">Отмена</button>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-8 flex flex-col items-center gap-4">
            <p className="text-red-500">{error}</p>
            <button onClick={goHome} className="text-[#007AFF] font-medium">На главную</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Memoized pending user row component

interface PendingUserRowProps {
  user: PendingUser;
  onApprove: (peerId: string) => void;
  onReject: (peerId: string) => void;
}

const PendingUserRow = memo(function PendingUserRow({ user, onApprove, onReject }: PendingUserRowProps) {
  const handleApprove = useCallback(() => onApprove(user.peerId), [onApprove, user.peerId]);
  const handleReject = useCallback(() => onReject(user.peerId), [onReject, user.peerId]);

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-gray-900 font-medium">{user.name}</span>
      <div className="flex gap-2">
        <button onClick={handleApprove} className="px-3 py-1.5 bg-[#34C759] text-white text-sm font-medium rounded-full">
          Да
        </button>
        <button onClick={handleReject} className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm font-medium rounded-full">
          Нет
        </button>
      </div>
    </div>
  );
});

// Participant row component with avatar
interface ParticipantRowProps {
  participant: Participant;
  isMe: boolean;
  status?: PeerStatus;
}

const ParticipantRow = memo(function ParticipantRow({ participant, isMe, status }: ParticipantRowProps) {
  const initials = useMemo(() => {
    const parts = participant.name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return participant.name.slice(0, 2).toUpperCase();
  }, [participant.name]);

  const bgColor = useMemo(() => {
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500',
      'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-cyan-500'
    ];
    let hash = 0;
    for (let i = 0; i < participant.peerId.length; i++) {
      hash = participant.peerId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }, [participant.peerId]);

  const isSpeaking = status && !status.isMuted && status.audioLevel > 15;
  const isMuted = status?.isMuted;

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="relative">
        <div
          className={`w-8 h-8 ${bgColor} rounded-full flex items-center justify-center text-white text-xs font-semibold transition-all ${
            isSpeaking ? 'ring-2 ring-green-400 ring-offset-1' : ''
          }`}
        >
          {initials}
        </div>
        {isMuted && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )}
      </div>
      <span className="text-gray-900 text-sm font-medium flex-1">
        {participant.name}
        {isMe && <span className="text-gray-400 ml-1">(вы)</span>}
      </span>
      {isSpeaking && (
        <div className="flex gap-0.5 items-end h-4">
          <div className="w-1 bg-green-500 rounded-full animate-pulse" style={{ height: '40%' }} />
          <div className="w-1 bg-green-500 rounded-full animate-pulse" style={{ height: '70%', animationDelay: '0.1s' }} />
          <div className="w-1 bg-green-500 rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
          <div className="w-1 bg-green-500 rounded-full animate-pulse" style={{ height: '60%', animationDelay: '0.3s' }} />
        </div>
      )}
      {participant.isHost && (
        <span className="text-xs text-[#007AFF] font-medium">Хост</span>
      )}
    </div>
  );
});
