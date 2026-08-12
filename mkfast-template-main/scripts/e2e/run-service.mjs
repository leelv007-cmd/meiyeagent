import { spawn } from 'node:child_process';

import {
  createOutputTail,
  createViteWorkerdFailureDetector,
  writeInstrumentFailureRecord,
  writeServiceExitRecord,
} from './service-exit-evidence.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error('run-service requires a command.');
}

const service = process.env.E2E_SERVICE_NAME ?? [command, ...args].join(' ');
// V31-70: workerd dies mid-gate with a fatal kj Broken pipe even in healthy
// runs, turning one infra crash into a gate-wide cascade. With a restart
// budget the supervisor respawns an unexpectedly dead service instead of
// forwarding its exit; every death still writes its own evidence record
// (marked `restarted: true` when healed) so nothing is hidden. Opt-in: the
// default of 0 keeps the original die-with-the-child semantics.
const maxRestarts = Math.max(
  0,
  Number.parseInt(process.env.E2E_SERVICE_MAX_RESTARTS ?? '0', 10) || 0
);
let restartsUsed = 0;

let currentChild;
let currentTail;
let shutdownTimer;
let shuttingDown = false;

const viteWorkerdFailureDetector =
  service === 'web'
    ? createViteWorkerdFailureDetector(({ kind, message, stream }) => {
        if (!currentChild?.pid || !currentTail) return;
        try {
          const { file } = writeInstrumentFailureRecord({
            kind,
            message,
            pid: currentChild.pid,
            service,
            stream,
            tail: currentTail.lines(),
          });
          process.stderr.write(
            `[run-service] ${service} emitted ${message}; ` +
              `instrument evidence: ${file}\n`
          );
        } catch (error) {
          process.stderr.write(
            `[run-service] failed to write instrument evidence for ` +
              `${service}: ${error}\n`
          );
        }
      })
    : undefined;

function forward(source, sink, stream, tail) {
  let writable = true;
  // The reader can disappear before the service does. An unhandled EPIPE would
  // kill this supervisor, orphaning the detached child and losing its exit
  // record, so a broken sink only stops the forwarding — the tail, the exit
  // record and the forwarded exit status all survive it.
  sink.on('error', () => {
    writable = false;
    source.resume();
  });
  source.setEncoding('utf8');
  source.on('data', (chunk) => {
    tail.append(stream, chunk);
    viteWorkerdFailureDetector?.append(stream, chunk);
    if (!writable) return;
    // Keep a slow reader back-pressuring the service exactly as the previously
    // inherited pipe did, instead of buffering its log in this process.
    if (sink.write(chunk)) return;
    source.pause();
    sink.once('drain', () => source.resume());
  });
}

function signalChildGroup(signal) {
  if (!currentChild?.pid) return;
  try {
    process.kill(
      process.platform === 'win32' ? currentChild.pid : -currentChild.pid,
      signal
    );
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  signalChildGroup(signal);
  shutdownTimer = setTimeout(() => signalChildGroup('SIGKILL'), 8_000);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

function launch() {
  const startedAt = Date.now();
  const tail = createOutputTail();
  currentTail = tail;
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  currentChild = child;

  forward(child.stdout, process.stdout, 'stdout', tail);
  forward(child.stderr, process.stderr, 'stderr', tail);

  let exitStatus;
  let exitAnnounced = false;
  let restarted = false;

  // A service that disappears mid-gate leaves no exit code, no signal and no
  // stack in the job log (see docs/ops/browser-gate-tail-triage-2026-08-12.md
  // §2.3). Persist all three plus the tail of its output, and never let
  // writing that evidence change the exit status this wrapper forwards.
  function recordExit() {
    if (!exitStatus) return;
    try {
      const { file } = writeServiceExitRecord({
        args,
        code: exitStatus.code,
        command,
        pid: child.pid,
        restarted,
        service,
        shutdownRequested: shuttingDown,
        signal: exitStatus.signal,
        startedAt,
        tail: tail.lines(),
      });
      if (exitAnnounced) return;
      exitAnnounced = true;
      const cause = exitStatus.signal
        ? `signal ${exitStatus.signal}`
        : `exit code ${exitStatus.code}`;
      process.stderr.write(
        `[run-service] ${service} exited with ${cause}; evidence: ${file}\n`
      );
    } catch (error) {
      process.stderr.write(
        `[run-service] failed to write exit evidence for ${service}: ${error}\n`
      );
    }
  }

  child.once('error', (error) => {
    clearTimeout(shutdownTimer);
    console.error(error);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    clearTimeout(shutdownTimer);
    exitStatus = { code, signal };
    restarted = !shuttingDown && restartsUsed < maxRestarts;
    recordExit();
    if (restarted) {
      restartsUsed += 1;
      process.stderr.write(
        `[run-service] restarting ${service} after unexpected ` +
          `${signal ? `signal ${signal}` : `exit code ${code}`} ` +
          `(${restartsUsed}/${maxRestarts})\n`
      );
      launch();
      return;
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  // Output flushed between `exit` and `close` still belongs to the tail; the
  // record is rewritten in place once the pipes drain.
  child.once('close', () => {
    recordExit();
  });
}

launch();
