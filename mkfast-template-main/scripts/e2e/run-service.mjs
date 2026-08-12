import { spawn } from 'node:child_process';

import {
  createOutputTail,
  writeServiceExitRecord,
} from './service-exit-evidence.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error('run-service requires a command.');
}

const service = process.env.E2E_SERVICE_NAME ?? [command, ...args].join(' ');
const startedAt = Date.now();
const tail = createOutputTail();

const child = spawn(command, args, {
  detached: process.platform !== 'win32',
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

function forward(source, sink, stream) {
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
    if (!writable) return;
    // Keep a slow reader back-pressuring the service exactly as the previously
    // inherited pipe did, instead of buffering its log in this process.
    if (sink.write(chunk)) return;
    source.pause();
    sink.once('drain', () => source.resume());
  });
}

forward(child.stdout, process.stdout, 'stdout');
forward(child.stderr, process.stderr, 'stderr');

let shutdownTimer;
let shuttingDown = false;
let exitStatus;
let exitAnnounced = false;

function signalChildGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
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

// A service that disappears mid-gate leaves no exit code, no signal and no
// stack in the job log (see docs/ops/browser-gate-tail-triage-2026-08-12.md
// §2.3). Persist all three plus the tail of its output, and never let writing
// that evidence change the exit status this wrapper forwards.
function recordExit() {
  if (!exitStatus) return;
  try {
    const { file } = writeServiceExitRecord({
      args,
      code: exitStatus.code,
      command,
      pid: child.pid,
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

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

child.once('error', (error) => {
  clearTimeout(shutdownTimer);
  console.error(error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  clearTimeout(shutdownTimer);
  exitStatus = { code, signal };
  recordExit();
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
