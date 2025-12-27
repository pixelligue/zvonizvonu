import { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import * as sfu from '../services/mediasoup.js';

interface SfuMessage {
  type: string;
  roomCode?: string;
  peerId?: string;
  name?: string;
  transportId?: string;
  dtlsParameters?: any;
  kind?: 'audio';
  rtpParameters?: any;
  producerId?: string;
  rtpCapabilities?: any;
}

// Хранилище WebSocket соединений и имён по комнатам
const roomSockets = new Map<string, Map<string, WebSocket>>();
const peerNames = new Map<string, Map<string, string>>(); // roomCode -> (peerId -> name)

function broadcast(roomCode: string, excludePeerId: string, data: object) {
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;

  const message = JSON.stringify(data);
  sockets.forEach((ws, peerId) => {
    if (peerId !== excludePeerId && ws.readyState === 1) {
      ws.send(message);
    }
  });
}

export async function sfuRoutes(app: FastifyInstance) {
  // WebSocket endpoint для SFU signaling
  app.get('/sfu', { websocket: true }, (socket, req) => {
    let currentRoom: string | null = null;
    let currentPeerId: string | null = null;

    const send = (data: object) => {
      socket.send(JSON.stringify(data));
    };

    socket.on('message', async (rawData) => {
      try {
        const msg: SfuMessage = JSON.parse(rawData.toString());

        switch (msg.type) {
          case 'join': {
            if (!msg.roomCode || !msg.peerId) {
              send({ type: 'error', error: 'Missing roomCode or peerId' });
              return;
            }

            currentRoom = msg.roomCode;
            currentPeerId = msg.peerId;
            const peerName = msg.name || 'Участник';

            // Добавляем socket в комнату
            if (!roomSockets.has(msg.roomCode)) {
              roomSockets.set(msg.roomCode, new Map());
            }
            roomSockets.get(msg.roomCode)!.set(msg.peerId, socket);

            // Сохраняем имя
            if (!peerNames.has(msg.roomCode)) {
              peerNames.set(msg.roomCode, new Map());
            }
            peerNames.get(msg.roomCode)!.set(msg.peerId, peerName);

            // Создаём или получаем комнату
            await sfu.getOrCreateRoom(msg.roomCode);
            sfu.addPeer(msg.roomCode, msg.peerId);

            // Отправляем RTP capabilities и список участников
            const rtpCapabilities = sfu.getRouterRtpCapabilities(msg.roomCode);
            const existingParticipants: Array<{ peerId: string; name: string }> = [];
            peerNames.get(msg.roomCode)?.forEach((name, peerId) => {
              if (peerId !== msg.peerId) {
                existingParticipants.push({ peerId, name });
              }
            });
            send({ type: 'joined', rtpCapabilities, participants: existingParticipants });

            // Уведомляем других о новом участнике
            broadcast(msg.roomCode, msg.peerId, {
              type: 'peerJoined',
              peerId: msg.peerId,
              name: peerName,
            });
            break;
          }

          case 'createTransport': {
            if (!currentRoom || !currentPeerId) {
              send({ type: 'error', error: 'Not joined' });
              return;
            }

            const transport = await sfu.createWebRtcTransport(currentRoom, currentPeerId);
            if (!transport) {
              send({ type: 'error', error: 'Failed to create transport' });
              return;
            }

            send({ type: 'transportCreated', transport });
            break;
          }

          case 'connectTransport': {
            if (!currentRoom || !currentPeerId || !msg.transportId || !msg.dtlsParameters) {
              send({ type: 'error', error: 'Missing parameters' });
              return;
            }

            const success = await sfu.connectTransport(
              currentRoom,
              currentPeerId,
              msg.transportId,
              msg.dtlsParameters
            );

            send({ type: 'transportConnected', success });
            break;
          }

          case 'produce': {
            if (!currentRoom || !currentPeerId || !msg.transportId || !msg.kind || !msg.rtpParameters) {
              send({ type: 'error', error: 'Missing parameters' });
              return;
            }

            const producerId = await sfu.produce(
              currentRoom,
              currentPeerId,
              msg.transportId,
              msg.kind,
              msg.rtpParameters
            );

            if (!producerId) {
              send({ type: 'error', error: 'Failed to produce' });
              return;
            }

            send({ type: 'produced', producerId });

            // Уведомляем других о новом producer (с именем)
            const producerName = peerNames.get(currentRoom)?.get(currentPeerId) || 'Участник';
            broadcast(currentRoom, currentPeerId, {
              type: 'newProducer',
              peerId: currentPeerId,
              producerId,
              name: producerName,
            });
            break;
          }

          case 'consume': {
            if (!currentRoom || !currentPeerId || !msg.transportId || !msg.producerId || !msg.rtpCapabilities) {
              send({ type: 'error', error: 'Missing parameters' });
              return;
            }

            const consumer = await sfu.consume(
              currentRoom,
              currentPeerId,
              msg.transportId,
              msg.producerId,
              msg.rtpCapabilities
            );

            if (!consumer) {
              send({ type: 'error', error: 'Failed to consume' });
              return;
            }

            send({ type: 'consumed', consumer });
            break;
          }

          case 'getProducers': {
            if (!currentRoom || !currentPeerId) {
              send({ type: 'error', error: 'Not joined' });
              return;
            }

            const producers = sfu.getOtherProducers(currentRoom, currentPeerId);
            send({ type: 'producers', producers });
            break;
          }

          default:
            send({ type: 'error', error: `Unknown message type: ${msg.type}` });
        }
      } catch (e) {
        console.error('[sfu] Message error:', e);
        send({ type: 'error', error: 'Internal error' });
      }
    });

    socket.on('close', () => {
      if (currentRoom && currentPeerId) {
        // Получаем имя перед удалением
        const leavingName = peerNames.get(currentRoom)?.get(currentPeerId) || 'Участник';

        // Удаляем socket из комнаты
        const sockets = roomSockets.get(currentRoom);
        if (sockets) {
          sockets.delete(currentPeerId);
          if (sockets.size === 0) {
            roomSockets.delete(currentRoom);
          }
        }

        // Удаляем имя
        const names = peerNames.get(currentRoom);
        if (names) {
          names.delete(currentPeerId);
          if (names.size === 0) {
            peerNames.delete(currentRoom);
          }
        }

        // Уведомляем других что peer ушёл
        broadcast(currentRoom, currentPeerId, {
          type: 'peerLeft',
          peerId: currentPeerId,
          name: leavingName,
        });

        sfu.removePeer(currentRoom, currentPeerId);
      }
    });
  });

  // REST endpoint для получения RTP capabilities (опционально)
  app.get<{ Params: { code: string } }>('/api/sfu/:code/capabilities', async (req, reply) => {
    const capabilities = sfu.getRouterRtpCapabilities(req.params.code);
    if (!capabilities) {
      return reply.status(404).send({ error: 'Room not found' });
    }
    return { rtpCapabilities: capabilities };
  });
}
