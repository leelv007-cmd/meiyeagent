import type { Plugin } from 'vite';

interface SocketEventSource {
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
}

interface ConnectionEventSource {
  on(
    event: 'connection',
    listener: (socket: SocketEventSource) => void
  ): unknown;
  on?(
    event: 'clientError',
    listener: (error: NodeJS.ErrnoException, socket: SocketEventSource) => void
  ): unknown;
}

/** True when a peer dropped mid-request; not a product failure in long e2e runs. */
export function isDisconnectedSocketError(
  error: NodeJS.ErrnoException | Error | unknown
): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as NodeJS.ErrnoException;
  const disconnectedReset =
    err.code === 'ECONNRESET' &&
    (err.syscall === 'read' ||
      err.syscall === 'write' ||
      // Some Node/undici paths omit syscall on aborted peer sockets.
      err.syscall === undefined);
  const disconnectedWrite =
    err.code === 'EPIPE' &&
    (err.syscall === 'write' || err.syscall === undefined);
  return disconnectedReset || disconnectedWrite;
}

export function attachDisconnectedSocketGuard(server: ConnectionEventSource) {
  server.on('connection', (socket) => {
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (isDisconnectedSocketError(error)) {
        return;
      }
      throw error;
    });
  });
  // HTTP parser client aborts also surface here; without a listener Node can
  // still take down the process on some proxy paths.
  server.on?.('clientError', (error, socket) => {
    if (isDisconnectedSocketError(error)) {
      try {
        (socket as { destroy?: () => void }).destroy?.();
      } catch {
        // ignore destroy races after peer reset
      }
      return;
    }
    throw error;
  });
}

let processGuardInstalled = false;

/**
 * Last-resort containment for long Playwright stacks: an unhandled
 * ECONNRESET on an outbound Core proxy socket otherwise prints
 * "Unhandled 'error' event" and exits Node, killing the whole suite.
 * Only swallows disconnected peer resets — other errors rethrow.
 */
export function installE2eDisconnectedProcessGuard(
  log: (message: string) => void = console.warn
): void {
  if (processGuardInstalled) return;
  processGuardInstalled = true;
  process.on('uncaughtException', (error) => {
    if (isDisconnectedSocketError(error)) {
      log(
        `[e2e] suppressed disconnected socket (${(error as NodeJS.ErrnoException).code ?? 'unknown'}); continuing suite`
      );
      return;
    }
    // Re-throwing from uncaughtException is unreliable; exit fail-closed.
    console.error(error);
    process.exit(1);
  });
}

export function e2eDisconnectedSocketPlugin(): Plugin {
  return {
    name: 'meiye:e2e-disconnected-socket',
    apply: 'serve',
    configureServer(server) {
      installE2eDisconnectedProcessGuard();
      const attach = () => {
        if (server.httpServer) {
          attachDisconnectedSocketGuard(server.httpServer);
        }
      };
      // httpServer is often still null during the first configureServer pass
      // (created at listen). Attach now if present, and again in the post-hook
      // after internal middleware / listen wiring.
      attach();
      return () => {
        attach();
      };
    },
  };
}
