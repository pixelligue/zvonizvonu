'use client';

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useMicrophone } from '@/hooks/useMicrophone';
import { useRecorder } from '@/hooks/useRecorder';
import { useSFU } from '@/hooks/useSFU';
import { MicLevel } from '@/components/MicLevel';
import { ControlButton } from '@/components/room';
import { MicIcon, MicOffIcon, PhoneOffIcon, LinkIcon, RecordIcon } from '@/components/icons';

interface SFURoomProps {
  code: string;
  isHost: boolean;
  onLeave: () => void;
}

export function SFURoom({ code, isHost, onLeave }: SFURoomProps) {
  const mic = useMicrophone();
  const recorder = useRecorder();
  const sfu = useSFU();
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState('');

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${code}?sfu=true`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  // Подключаемся когда есть микрофон и имя
  const connect = useCallback(async () => {
    if (!mic.stream) return;
    const displayName = name.trim() || (isHost ? 'Хост' : 'Участник');

    const peerId = `peer-${Math.random().toString(36).slice(2)}`;
    await sfu.connect(code, peerId, displayName, mic.stream);
  }, [code, mic.stream, name, isHost, sfu]);

  // Воспроизводим удалённое аудио
  useEffect(() => {
    sfu.remoteAudios.forEach(({ peerId, stream }) => {
      if (!audioElementsRef.current.has(peerId)) {
        const audio = new Audio();
        audio.srcObject = stream;
        audio.autoplay = true;
        audioElementsRef.current.set(peerId, audio);
      }
    });

    // Удаляем старые
    audioElementsRef.current.forEach((audio, peerId) => {
      if (!sfu.remoteAudios.find(a => a.peerId === peerId)) {
        audio.pause();
        audio.srcObject = null;
        audioElementsRef.current.delete(peerId);
      }
    });
  }, [sfu.remoteAudios]);

  // Синхронизируем mute
  useEffect(() => {
    sfu.toggleMute(mic.isMuted);
  }, [mic.isMuted, sfu]);

  // Cleanup
  useEffect(() => {
    return () => {
      audioElementsRef.current.forEach(audio => {
        audio.pause();
        audio.srcObject = null;
      });
    };
  }, []);

  const handleLeave = useCallback(() => {
    if (recorder.isRecording) recorder.stopRecording();
    sfu.disconnect();
    mic.stopMic();
    onLeave();
  }, [recorder, sfu, mic, onLeave]);

  const toggleRecording = useCallback(() => {
    if (recorder.isRecording) {
      recorder.stopRecording();
    } else if (mic.stream) {
      const remoteStreams = sfu.remoteAudios.map(a => a.stream);
      recorder.startRecording(mic.stream, remoteStreams);
    }
  }, [recorder, mic.stream, sfu.remoteAudios]);

  const micButtonIcon = useMemo(
    () => mic.isMuted ? <MicOffIcon /> : <MicIcon />,
    [mic.isMuted]
  );
  const recordButtonIcon = useMemo(() => <RecordIcon />, []);
  const phoneOffButtonIcon = useMemo(() => <PhoneOffIcon />, []);

  // Этап настройки
  if (!mic.stream) {
    return (
      <div className="w-full max-w-sm bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-8 space-y-6">
        <div className="flex items-center justify-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-xl px-3 py-2">
          <span className="font-medium">Режим большого митинга</span>
          <span className="text-blue-400">до 30 человек</span>
        </div>
        <p className="text-center text-gray-600">{isHost ? 'Вы создаёте комнату' : 'Вы присоединяетесь'}</p>
        <button
          onClick={mic.startMic}
          className="w-full py-4 bg-[#007AFF] hover:bg-[#0066d6] text-white text-lg font-medium rounded-2xl transition-all active:scale-[0.98]"
        >
          Разрешить микрофон
        </button>
        {mic.error && <p className="text-red-500 text-center text-sm">{mic.error}</p>}
      </div>
    );
  }

  // Готов к подключению
  if (!sfu.isConnected && !sfu.error) {
    return (
      <div className="w-full max-w-sm bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-8 space-y-6">
        <div className="flex items-center justify-center gap-2 text-sm text-blue-600 bg-blue-50 rounded-xl px-3 py-2">
          <span className="font-medium">Режим большого митинга</span>
        </div>
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
            <MicLevel level={mic.level} isMuted={mic.isMuted} />
          </div>
          <p className="text-green-600 text-sm font-medium">Микрофон работает</p>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ваше имя"
          className="w-full py-4 px-5 bg-gray-100 text-gray-900 placeholder-gray-400 rounded-2xl border-0 focus:ring-2 focus:ring-[#007AFF] focus:outline-none"
        />
        <button
          onClick={connect}
          className="w-full py-4 bg-[#34C759] hover:bg-[#2db84d] text-white text-lg font-medium rounded-2xl transition-all active:scale-[0.98]"
        >
          {isHost ? 'Начать' : 'Присоединиться'}
        </button>
      </div>
    );
  }

  // Ошибка
  if (sfu.error) {
    return (
      <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-8 flex flex-col items-center gap-4">
        <p className="text-red-500">{sfu.error}</p>
        <button onClick={onLeave} className="text-[#007AFF] font-medium">На главную</button>
      </div>
    );
  }

  // Подключено
  return (
    <div className="w-full max-w-sm space-y-4">
      <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-6 flex flex-col items-center gap-4">
        <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
          <MicLevel level={mic.level} isMuted={mic.isMuted} light />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">SFU</span>
          <span className="text-green-600 font-medium">Подключено ({sfu.peerCount + 1})</span>
        </div>
        {recorder.isRecording && (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            Запись {recorder.formattedDuration}
          </div>
        )}
        <button
          onClick={copyLink}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-full text-sm text-gray-700 transition-colors"
        >
          <LinkIcon />
          {copied ? 'Скопировано!' : 'Скопировать ссылку'}
        </button>
      </div>

      {/* Список участников */}
      {sfu.remoteAudios.length > 0 && (
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-6 space-y-3">
          <p className="text-gray-500 text-sm font-medium">Участники ({sfu.remoteAudios.length})</p>
          <div className="space-y-2">
            {sfu.remoteAudios.map(({ peerId, name: participantName }) => (
              <div key={peerId} className="flex items-center gap-3 py-2">
                <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-medium">
                    {participantName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="text-gray-900 font-medium">{participantName}</span>
                <span className="w-2 h-2 bg-green-500 rounded-full ml-auto" title="В сети" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-center gap-3">
        <ControlButton onClick={mic.toggleMute} active={!mic.isMuted} icon={micButtonIcon} color="gray" />
        <ControlButton onClick={toggleRecording} active={recorder.isRecording} icon={recordButtonIcon} color="red" />
        <ControlButton onClick={handleLeave} active icon={phoneOffButtonIcon} color="red" />
      </div>
    </div>
  );
}
