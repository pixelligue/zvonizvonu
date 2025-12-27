import { FastifyInstance } from 'fastify';
import {
  createRoom, getRoom, setHost, requestJoin,
  approveJoin, rejectJoin, getPending, leaveRoom,
  setScreenShare, allowRecording, disallowRecording, getRoomSettings,
  getParticipants
} from '../services/rooms.js';

export async function roomRoutes(app: FastifyInstance) {
  app.post('/api/rooms', async () => {
    return { code: createRoom() };
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (req, reply) => {
    const room = getRoom(req.params.code);
    if (!room) return reply.status(404).send({ error: 'Room not found' });
    const settings = getRoomSettings(req.params.code);
    const participants = getParticipants(req.params.code);
    return {
      code: req.params.code.toUpperCase(),
      hasHost: !!room.hostId,
      peers: Array.from(room.peers),
      participants,
      ...settings,
    };
  });

  app.get<{ Params: { code: string } }>('/api/rooms/:code/participants', async (req, reply) => {
    const participants = getParticipants(req.params.code);
    return { participants };
  });

  app.post<{ Params: { code: string }; Body: { peerId: string; name?: string } }>(
    '/api/rooms/:code/host',
    async (req, reply) => {
      const ok = setHost(req.params.code, req.body.peerId, req.body.name);
      if (!ok) return reply.status(404).send({ error: 'Room not found' });
      return { success: true };
    }
  );

  app.post<{ Params: { code: string }; Body: { peerId: string; name: string } }>(
    '/api/rooms/:code/request',
    async (req, reply) => {
      const ok = requestJoin(req.params.code, req.body.peerId, req.body.name);
      if (!ok) return reply.status(404).send({ error: 'Room not found' });
      return { success: true };
    }
  );

  app.get<{ Params: { code: string } }>('/api/rooms/:code/pending', async (req) => {
    return { pending: getPending(req.params.code) };
  });

  app.post<{ Params: { code: string }; Body: { peerId: string } }>(
    '/api/rooms/:code/approve',
    async (req, reply) => {
      const peers = approveJoin(req.params.code, req.body.peerId);
      if (!peers) return reply.status(404).send({ error: 'Room not found' });
      return { peers };
    }
  );

  app.post<{ Params: { code: string }; Body: { peerId: string } }>(
    '/api/rooms/:code/reject',
    async (req) => {
      rejectJoin(req.params.code, req.body.peerId);
      return { success: true };
    }
  );

  app.post<{ Params: { code: string }; Body: { peerId: string } }>(
    '/api/rooms/:code/leave',
    async (req) => {
      leaveRoom(req.params.code, req.body.peerId);
      return { success: true };
    }
  );

  // Screen share toggle (host only)
  app.post<{ Params: { code: string }; Body: { enabled: boolean } }>(
    '/api/rooms/:code/screen-share',
    async (req, reply) => {
      const ok = setScreenShare(req.params.code, req.body.enabled);
      if (!ok) return reply.status(404).send({ error: 'Room not found' });
      return { success: true, screenShareEnabled: req.body.enabled };
    }
  );

  // Allow recording for a peer (host only)
  app.post<{ Params: { code: string }; Body: { peerId: string } }>(
    '/api/rooms/:code/allow-recording',
    async (req, reply) => {
      const ok = allowRecording(req.params.code, req.body.peerId);
      if (!ok) return reply.status(404).send({ error: 'Room not found' });
      return { success: true };
    }
  );

  // Disallow recording for a peer (host only)
  app.post<{ Params: { code: string }; Body: { peerId: string } }>(
    '/api/rooms/:code/disallow-recording',
    async (req, reply) => {
      const ok = disallowRecording(req.params.code, req.body.peerId);
      if (!ok) return reply.status(404).send({ error: 'Room not found' });
      return { success: true };
    }
  );

  // Get room settings
  app.get<{ Params: { code: string } }>('/api/rooms/:code/settings', async (req, reply) => {
    const settings = getRoomSettings(req.params.code);
    if (!settings) return reply.status(404).send({ error: 'Room not found' });
    return settings;
  });
}
