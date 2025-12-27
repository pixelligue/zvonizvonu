import express from 'express';
import { createServer, Server } from 'http';
import { ExpressPeerServer } from 'peer';
import { config } from '../config.js';

export function createPeerServer(): Server {
  const app = express();
  const server = createServer(app);

  const peerJs = ExpressPeerServer(server, {
    path: '/',
    allow_discovery: true,
  });

  app.use('/peerjs', peerJs);
  return server;
}

export function startPeerServer(server: Server): void {
  server.listen(config.peerPort, () => {
    console.log(`PeerServer running on http://localhost:${config.peerPort}/peerjs`);
  });
}
