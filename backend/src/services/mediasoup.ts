import * as mediasoup from 'mediasoup';
import { types } from 'mediasoup';
import os from 'os';

// Конфигурация mediasoup
const config = {
  // Worker settings
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn' as types.WorkerLogLevel,
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'] as types.WorkerLogTag[],
  },
  // Router media codecs
  router: {
    mediaCodecs: [
      {
        kind: 'audio' as const,
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
    ],
  },
  // WebRtcTransport settings
  webRtcTransport: {
    listenIps: [
      { ip: '0.0.0.0', announcedIp: undefined as string | undefined },
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  },
};

// Получаем локальный IP для announcedIp
function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Хранилище
const workers: types.Worker[] = [];
let nextWorkerIdx = 0;

interface RoomState {
  router: types.Router;
  peers: Map<string, PeerState>;
}

interface PeerState {
  transports: Map<string, types.WebRtcTransport>;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
}

const rooms = new Map<string, RoomState>();

// Инициализация workers
export async function initMediasoup(): Promise<void> {
  const numWorkers = Math.min(os.cpus().length, 4);

  // Устанавливаем announcedIp
  config.webRtcTransport.listenIps[0].announcedIp = getLocalIp();

  console.log(`[mediasoup] Creating ${numWorkers} workers...`);

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker(config.worker);

    worker.on('died', () => {
      console.error(`[mediasoup] Worker ${i} died, exiting...`);
      process.exit(1);
    });

    workers.push(worker);
  }

  console.log(`[mediasoup] ${numWorkers} workers created`);
}

// Получить следующий worker (round-robin)
function getNextWorker(): types.Worker {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

// Создать или получить комнату
export async function getOrCreateRoom(roomCode: string): Promise<RoomState> {
  let room = rooms.get(roomCode);

  if (!room) {
    const worker = getNextWorker();
    const router = await worker.createRouter({ mediaCodecs: config.router.mediaCodecs });

    room = {
      router,
      peers: new Map(),
    };

    rooms.set(roomCode, room);
    console.log(`[mediasoup] Room ${roomCode} created`);
  }

  return room;
}

// Удалить комнату
export function deleteRoom(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (room) {
    room.router.close();
    rooms.delete(roomCode);
    console.log(`[mediasoup] Room ${roomCode} deleted`);
  }
}

// Добавить peer в комнату
export function addPeer(roomCode: string, peerId: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.peers.set(peerId, {
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  });
}

// Удалить peer из комнаты
export function removePeer(roomCode: string, peerId: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;

  const peer = room.peers.get(peerId);
  if (peer) {
    // Закрываем все транспорты (это автоматически закроет producers и consumers)
    peer.transports.forEach(transport => transport.close());
    room.peers.delete(peerId);
  }

  // Если комната пуста - удаляем
  if (room.peers.size === 0) {
    deleteRoom(roomCode);
  }
}

// Получить RTP capabilities роутера
export function getRouterRtpCapabilities(roomCode: string): types.RtpCapabilities | null {
  const room = rooms.get(roomCode);
  return room?.router.rtpCapabilities || null;
}

// Создать WebRTC Transport
export async function createWebRtcTransport(
  roomCode: string,
  peerId: string
): Promise<{
  id: string;
  iceParameters: types.IceParameters;
  iceCandidates: types.IceCandidate[];
  dtlsParameters: types.DtlsParameters;
} | null> {
  const room = rooms.get(roomCode);
  const peer = room?.peers.get(peerId);
  if (!room || !peer) return null;

  const transport = await room.router.createWebRtcTransport(config.webRtcTransport);

  peer.transports.set(transport.id, transport);

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

// Подключить Transport
export async function connectTransport(
  roomCode: string,
  peerId: string,
  transportId: string,
  dtlsParameters: types.DtlsParameters
): Promise<boolean> {
  const room = rooms.get(roomCode);
  const peer = room?.peers.get(peerId);
  const transport = peer?.transports.get(transportId);
  if (!transport) return false;

  await transport.connect({ dtlsParameters });
  return true;
}

// Создать Producer (отправка аудио)
export async function produce(
  roomCode: string,
  peerId: string,
  transportId: string,
  kind: types.MediaKind,
  rtpParameters: types.RtpParameters
): Promise<string | null> {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const peer = room.peers.get(peerId);
  if (!peer) return null;

  const transport = peer.transports.get(transportId);
  if (!transport) return null;

  const producer = await transport.produce({ kind, rtpParameters });
  peer.producers.set(producer.id, producer);

  producer.on('transportclose', () => {
    peer.producers.delete(producer.id);
  });

  return producer.id;
}

// Создать Consumer (получение аудио)
export async function consume(
  roomCode: string,
  peerId: string,
  transportId: string,
  producerId: string,
  rtpCapabilities: types.RtpCapabilities
): Promise<{
  id: string;
  producerId: string;
  kind: types.MediaKind;
  rtpParameters: types.RtpParameters;
} | null> {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const peer = room.peers.get(peerId);
  if (!peer) return null;

  const transport = peer.transports.get(transportId);
  if (!transport) return null;

  // Проверяем, может ли router создать consumer
  if (!room.router.canConsume({ producerId, rtpCapabilities })) {
    console.warn(`[mediasoup] Cannot consume producer ${producerId}`);
    return null;
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: false,
  });

  peer.consumers.set(consumer.id, consumer);

  consumer.on('transportclose', () => {
    peer.consumers.delete(consumer.id);
  });

  consumer.on('producerclose', () => {
    peer.consumers.delete(consumer.id);
  });

  return {
    id: consumer.id,
    producerId: consumer.producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

// Получить все producers в комнате (кроме своих)
export function getOtherProducers(roomCode: string, peerId: string): Array<{ peerId: string; producerId: string }> {
  const room = rooms.get(roomCode);
  if (!room) return [];

  const result: Array<{ peerId: string; producerId: string }> = [];

  room.peers.forEach((peer, pid) => {
    if (pid !== peerId) {
      peer.producers.forEach((producer) => {
        result.push({ peerId: pid, producerId: producer.id });
      });
    }
  });

  return result;
}

// Проверить, существует ли комната
export function roomExists(roomCode: string): boolean {
  return rooms.has(roomCode);
}

// Получить количество peers в комнате
export function getPeerCount(roomCode: string): number {
  return rooms.get(roomCode)?.peers.size || 0;
}
