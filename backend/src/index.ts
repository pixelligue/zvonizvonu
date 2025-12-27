import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { roomRoutes } from './routes/rooms.js';
import { healthRoutes } from './routes/health.js';
import { sfuRoutes } from './routes/sfu.js';
import { createPeerServer, startPeerServer } from './peer/index.js';
import { initMediasoup } from './services/mediasoup.js';

const app = Fastify({ logger: true });

// Инициализируем mediasoup
await initMediasoup();

await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
});

await app.register(websocket);

await app.register(roomRoutes);
await app.register(healthRoutes);
await app.register(sfuRoutes);

const peerServer = createPeerServer();

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`API server running on http://localhost:${config.port}`);
  console.log(`SFU WebSocket available at ws://localhost:${config.port}/sfu`);
  startPeerServer(peerServer);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
