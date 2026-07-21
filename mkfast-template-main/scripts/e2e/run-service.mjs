import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error('run-service requires a command.');
}

const child = spawn(command, args, {
  detached: process.platform !== 'win32',
  env: process.env,
  stdio: 'inherit',
});

let shutdownTimer;
let shuttingDown = false;

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

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

child.once('error', (error) => {
  clearTimeout(shutdownTimer);
  console.error(error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  clearTimeout(shutdownTimer);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
