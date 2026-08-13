import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function inspectListeningPort(port) {
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
    throw new Error(`Port must be an integer 1-65535 (got ${String(port)}).`);
  }

  let stdout = '';
  try {
    ({ stdout } = await execFileAsync(
      'lsof',
      ['-nP', `-iTCP:${numeric}`, '-sTCP:LISTEN', '-Fpcn'],
      { encoding: 'utf8' },
    ));
  } catch (error) {
    // lsof exits 1 when nothing is listening.
    if (error && typeof error === 'object' && error.code === 1) {
      return [];
    }
    throw error;
  }

  const occupants = [];
  let current = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      if (current?.pid) occupants.push(current);
      current = { pid: line.slice(1), command: '', name: '' };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('c')) current.command = line.slice(1);
    if (line.startsWith('n')) current.name = line.slice(1);
  }
  if (current?.pid) occupants.push(current);

  return Promise.all(
    occupants.map(async (occupant) => ({
      ...occupant,
      cmdline: await readCmdline(occupant.pid),
    })),
  );
}

async function readCmdline(pid) {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['-p', String(pid), '-www', '-o', 'args='],
      { encoding: 'utf8' },
    );
    if (stdout.trim()) return stdout.trim();
  } catch {
    // Sandboxes and some hosts refuse `ps`; fall through to pgrep.
  }
  try {
    const { stdout } = await execFileAsync(
      'pgrep',
      ['-lf', '-u', String(process.getuid())],
      { encoding: 'utf8' },
    );
    const line = stdout
      .split('\n')
      .find((entry) => entry.startsWith(`${pid} `));
    if (line) return line.slice(String(pid).length).trim();
  } catch {
    return '';
  }
  return '';
}

export function formatPortOccupiedError(label, port, occupants) {
  const rows = occupants
    .map((occupant) => {
      const cmd = occupant.cmdline || occupant.command || '(unknown cmdline)';
      return `  pid=${occupant.pid} cmdline=${cmd}`;
    })
    .join('\n');
  return [
    `${label} port ${port} is already in use. Refusing to start the development stack.`,
    occupants.length > 0 ? rows : '  (listener found, but lsof listed no pid)',
    'Stop the occupant or set PORT / CORE_PORT to free ports.',
  ].join('\n');
}

export async function assertStackPortsAvailable(profile) {
  const targets = [
    { label: 'web', port: String(profile.PORT ?? '3000') },
    { label: 'core', port: String(profile.CORE_PORT ?? '4100') },
  ];
  for (const target of targets) {
    const occupants = await inspectListeningPort(target.port);
    if (occupants.length > 0) {
      throw new Error(
        formatPortOccupiedError(target.label, target.port, occupants),
      );
    }
  }
}
