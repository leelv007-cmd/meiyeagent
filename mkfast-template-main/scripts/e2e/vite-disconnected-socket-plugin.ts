import type { Plugin } from 'vite';

interface SocketEventSource {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
}

interface ConnectionEventSource {
  on(
    event: 'connection',
    listener: (socket: SocketEventSource) => void
  ): unknown;
}

export function attachDisconnectedSocketGuard(server: ConnectionEventSource) {
  server.on('connection', (socket) => {
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (
        error.code === 'ECONNRESET' &&
        (error.syscall === 'read' || error.syscall === 'write')
      ) {
        return;
      }
      throw error;
    });
  });
}

export function e2eDisconnectedSocketPlugin(): Plugin {
  return {
    name: 'meiye:e2e-disconnected-socket',
    apply: 'serve',
    configureServer(server) {
      if (server.httpServer) {
        attachDisconnectedSocketGuard(server.httpServer);
      }
    },
  };
}
