import { useState, useCallback, useRef, useEffect } from 'react';
import { Device, types } from 'mediasoup-client';

type Transport = types.Transport;
type Producer = types.Producer;
type Consumer = types.Consumer;
type RtpCapabilities = types.RtpCapabilities;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:5005/sfu';

interface SFUState {
  isConnected: boolean;
  isProducing: boolean;
  error: string | null;
  peerCount: number;
}

interface Participant {
  peerId: string;
  name: string;
}

interface RemoteAudio {
  peerId: string;
  name: string;
  stream: MediaStream;
}

export function useSFU() {
  const [state, setState] = useState<SFUState>({
    isConnected: false,
    isProducing: false,
    error: null,
    peerCount: 0,
  });

  const [remoteAudios, setRemoteAudios] = useState<RemoteAudio[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const participantsRef = useRef<Map<string, string>>(new Map()); // peerId -> name
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producerRef = useRef<Producer | null>(null);
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const pendingRequests = useRef<Map<string, (data: any) => void>>(new Map());
  const rtpCapabilitiesRef = useRef<RtpCapabilities | null>(null);
  const roomCodeRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Отправить сообщение и ждать ответ
  const sendRequest = useCallback((type: string, data: object = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = Math.random().toString(36).slice(2);
      pendingRequests.current.set(type, resolve);

      wsRef.current.send(JSON.stringify({ type, ...data }));

      // Timeout
      setTimeout(() => {
        if (pendingRequests.current.has(type)) {
          pendingRequests.current.delete(type);
          reject(new Error(`Request ${type} timeout`));
        }
      }, 10000);
    });
  }, []);

  // Обработка сообщений от сервера
  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = JSON.parse(event.data);

    // Ищем pending request
    const responseTypes: Record<string, string> = {
      joined: 'join',
      transportCreated: 'createTransport',
      transportConnected: 'connectTransport',
      produced: 'produce',
      consumed: 'consume',
      producers: 'getProducers',
    };

    const requestType = responseTypes[msg.type];
    if (requestType && pendingRequests.current.has(requestType)) {
      const resolve = pendingRequests.current.get(requestType)!;
      pendingRequests.current.delete(requestType);
      resolve(msg);
      return;
    }

    // Обработка событий
    switch (msg.type) {
      case 'newProducer':
        // Новый producer — создаём consumer
        if (msg.name) {
          participantsRef.current.set(msg.peerId, msg.name);
          updateParticipantsList();
        }
        await consumeProducer(msg.peerId, msg.producerId, msg.name || 'Участник');
        break;

      case 'peerJoined':
        // Новый участник присоединился
        if (msg.peerId && msg.name) {
          participantsRef.current.set(msg.peerId, msg.name);
          updateParticipantsList();
        }
        break;

      case 'producerClosed':
      case 'peerLeft':
        // Producer закрылся или peer ушёл — удаляем consumer
        if (msg.producerId) {
          const consumer = consumersRef.current.get(msg.producerId);
          if (consumer) {
            consumer.close();
            consumersRef.current.delete(msg.producerId);
          }
        }
        participantsRef.current.delete(msg.peerId);
        updateParticipantsList();
        setRemoteAudios(prev => prev.filter(a => a.peerId !== msg.peerId));
        setState(s => ({ ...s, peerCount: consumersRef.current.size }));
        break;

      case 'error':
        console.error('[SFU] Error:', msg.error);
        setState(s => ({ ...s, error: msg.error }));
        break;
    }
  }, []);

  // Обновить список участников
  const updateParticipantsList = useCallback(() => {
    const list: Participant[] = [];
    participantsRef.current.forEach((name, peerId) => {
      list.push({ peerId, name });
    });
    setParticipants(list);
  }, []);

  // Создать consumer для producer
  const consumeProducer = useCallback(async (peerId: string, producerId: string, name: string = 'Участник') => {
    if (!recvTransportRef.current || !rtpCapabilitiesRef.current) return;

    try {
      const response = await sendRequest('consume', {
        transportId: recvTransportRef.current.id,
        producerId,
        rtpCapabilities: rtpCapabilitiesRef.current,
      });

      if (!response.consumer) return;

      const consumer = await recvTransportRef.current.consume({
        id: response.consumer.id,
        producerId: response.consumer.producerId,
        kind: response.consumer.kind,
        rtpParameters: response.consumer.rtpParameters,
      });

      consumersRef.current.set(producerId, consumer);

      // Создаём MediaStream из consumer
      const stream = new MediaStream([consumer.track]);
      setRemoteAudios(prev => [...prev, { peerId, name, stream }]);

      setState(s => ({ ...s, peerCount: consumersRef.current.size }));
    } catch (e) {
      console.error('[SFU] Failed to consume:', e);
    }
  }, [sendRequest]);

  // Подключиться к комнате
  const connect = useCallback(async (roomCode: string, peerId: string, name: string, localStream: MediaStream) => {
    try {
      setState(s => ({ ...s, error: null }));

      roomCodeRef.current = roomCode;
      peerIdRef.current = peerId;
      localStreamRef.current = localStream;

      // Сохраняем своё имя
      participantsRef.current.set(peerId, name);

      // Создаём WebSocket соединение
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
        setTimeout(() => reject(new Error('WebSocket timeout')), 5000);
      });

      ws.onmessage = handleMessage;
      ws.onclose = () => {
        setState(s => ({ ...s, isConnected: false }));
      };

      // Присоединяемся к комнате
      const joinResponse = await sendRequest('join', { roomCode, peerId, name });
      const rtpCapabilities = joinResponse.rtpCapabilities;
      rtpCapabilitiesRef.current = rtpCapabilities;

      // Загружаем существующих участников
      if (joinResponse.participants) {
        for (const p of joinResponse.participants) {
          participantsRef.current.set(p.peerId, p.name);
        }
        updateParticipantsList();
      }

      // Создаём Device
      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      // Создаём Send Transport
      const sendTransportData = await sendRequest('createTransport');
      const sendTransport = device.createSendTransport({
        id: sendTransportData.transport.id,
        iceParameters: sendTransportData.transport.iceParameters,
        iceCandidates: sendTransportData.transport.iceCandidates,
        dtlsParameters: sendTransportData.transport.dtlsParameters,
      });

      sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await sendRequest('connectTransport', {
            transportId: sendTransport.id,
            dtlsParameters,
          });
          callback();
        } catch (e) {
          errback(e as Error);
        }
      });

      sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        try {
          const response = await sendRequest('produce', {
            transportId: sendTransport.id,
            kind,
            rtpParameters,
          });
          callback({ id: response.producerId });
        } catch (e) {
          errback(e as Error);
        }
      });

      sendTransportRef.current = sendTransport;

      // Создаём Receive Transport
      const recvTransportData = await sendRequest('createTransport');
      const recvTransport = device.createRecvTransport({
        id: recvTransportData.transport.id,
        iceParameters: recvTransportData.transport.iceParameters,
        iceCandidates: recvTransportData.transport.iceCandidates,
        dtlsParameters: recvTransportData.transport.dtlsParameters,
      });

      recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await sendRequest('connectTransport', {
            transportId: recvTransport.id,
            dtlsParameters,
          });
          callback();
        } catch (e) {
          errback(e as Error);
        }
      });

      recvTransportRef.current = recvTransport;

      // Начинаем отправлять аудио
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        const producer = await sendTransport.produce({ track: audioTrack });
        producerRef.current = producer;
        setState(s => ({ ...s, isProducing: true }));
      }

      // Получаем существующих producers
      const producersResponse = await sendRequest('getProducers');
      for (const { peerId: pid, producerId } of producersResponse.producers || []) {
        await consumeProducer(pid, producerId);
      }

      setState(s => ({ ...s, isConnected: true }));
    } catch (e) {
      console.error('[SFU] Connection failed:', e);
      setState(s => ({ ...s, error: (e as Error).message }));
    }
  }, [handleMessage, sendRequest, consumeProducer]);

  // Отключиться
  const disconnect = useCallback(() => {
    producerRef.current?.close();
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();
    consumersRef.current.forEach(c => c.close());
    consumersRef.current.clear();
    wsRef.current?.close();

    producerRef.current = null;
    sendTransportRef.current = null;
    recvTransportRef.current = null;
    deviceRef.current = null;
    wsRef.current = null;

    setRemoteAudios([]);
    setState({
      isConnected: false,
      isProducing: false,
      error: null,
      peerCount: 0,
    });
  }, []);

  // Mute/unmute
  const toggleMute = useCallback((muted: boolean) => {
    if (producerRef.current) {
      if (muted) {
        producerRef.current.pause();
      } else {
        producerRef.current.resume();
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    remoteAudios,
    participants,
    connect,
    disconnect,
    toggleMute,
  };
}
