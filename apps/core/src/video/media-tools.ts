import { spawn } from 'node:child_process';

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
    options?: { cause?: unknown }
  ) {
    super(`${command} exited with ${exitCode ?? 'no exit code'}: ${stderr.trim()}`, options);
    this.name = 'MediaCommandError';
  }
}

export async function runMediaCommand(
  command: string,
  args: readonly string[],
  signal?: AbortSignal
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      reject(new MediaCommandError(command, args, null, stderr, { cause: error }));
    });
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new MediaCommandError(command, args, code, stderr));
    });
  });
}

export interface MediaToolDetection {
  available: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  reason: string;
}

export async function detectMediaTools(options: {
  ffmpegPath?: string;
  ffprobePath?: string;
} = {}): Promise<MediaToolDetection> {
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffprobePath = options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
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
  try {
    const filters = await runMediaCommand(ffmpegPath, ['-hide_banner', '-filters']);
    if (!/(^|\s)drawtext\s/m.test(filters.stdout)) {
      return {
        available: false,
        ffmpegPath,
        ffprobePath,
        reason: 'ffmpeg unavailable for composition: drawtext filter is missing',
      };
    }
  } catch (error) {
    return {
      available: false,
      ffmpegPath,
      ffprobePath,
      reason: `ffmpeg filter detection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    available: true,
    ffmpegPath,
    ffprobePath,
    reason: '',
  };
}
