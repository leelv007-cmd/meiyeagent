import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export class MediaCommandError extends Error {
  constructor(
    readonly command: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    options?: { cause?: unknown },
  ) {
    super(
      `${command} exited with ${exitCode ?? 'no exit code'}: ${stderr.trim()}`,
      options,
    );
    this.name = 'MediaCommandError';
  }
}

export async function runMediaCommand(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      encoding: 'utf8',
      maxBuffer: Number.POSITIVE_INFINITY,
      ...(signal ? { signal } : {}),
    });
    return { stdout, stderr };
  } catch (cause) {
    const failure = cause as { code?: unknown; stderr?: unknown };
    const exitCode = typeof failure.code === 'number' ? failure.code : null;
    const stderr = typeof failure.stderr === 'string' ? failure.stderr : '';
    const isCommandError =
      failure.code !== null && typeof failure.code !== 'number';
    throw new MediaCommandError(
      command,
      args,
      exitCode,
      stderr,
      isCommandError ? { cause } : undefined,
    );
  }
}

export interface MediaToolDetection {
  available: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  reason: string;
}

export async function detectMediaTools(
  options: {
    ffmpegPath?: string;
    ffprobePath?: string;
  } = {},
): Promise<MediaToolDetection> {
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffprobePath =
    options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
  try {
    await runMediaCommand(ffmpegPath, ['-version']);
  } catch (error) {
    return {
      available: false,
      ffmpegPath,
      ffprobePath,
      reason: `ffmpeg unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    await runMediaCommand(ffprobePath, ['-version']);
  } catch (error) {
    return {
      available: false,
      ffmpegPath,
      ffprobePath,
      reason: `ffprobe unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    available: true,
    ffmpegPath,
    ffprobePath,
    reason: '',
  };
}
