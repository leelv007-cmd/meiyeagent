export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env) {
  return resolveTool(env.FFMPEG_PATH, 'ffmpeg');
}

export function resolveFfprobePath(env: NodeJS.ProcessEnv = process.env) {
  return resolveTool(env.FFPROBE_PATH, 'ffprobe');
}

function resolveTool(explicit: string | undefined, fallback: string) {
  const configured = explicit?.trim();
  return configured || fallback;
}
