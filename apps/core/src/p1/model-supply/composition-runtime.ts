import {
  FfmpegVideoCompositionPort,
  type CompositionAssetStoragePort,
} from './ffmpeg-composition-port.js';
import {
  RecordedVideoCompositionPort,
  type VideoCompositionPort,
} from './index.js';
import { resolveFfmpegPath, resolveFfprobePath } from './media-tool-paths.js';

export function videoCompositionRuntimeFromEnv(
  env: NodeJS.ProcessEnv,
  storage: CompositionAssetStoragePort,
): VideoCompositionPort {
  const mode = env.P1_VIDEO_COMPOSITION_MODE ?? 'ffmpeg';
  if (mode === 'recorded') {
    if (env.APP_ENV !== 'e2e') {
      throw new Error(
        'P1_VIDEO_COMPOSITION_MODE=recorded is restricted to APP_ENV=e2e.',
      );
    }
    return new RecordedVideoCompositionPort(storage);
  }
  if (mode !== 'ffmpeg') {
    throw new Error('P1_VIDEO_COMPOSITION_MODE must be ffmpeg or recorded.');
  }
  return new FfmpegVideoCompositionPort(storage, {
    ffmpegPath: resolveFfmpegPath(env),
    ffprobePath: resolveFfprobePath(env),
    ...(env.FFMPEG_FONT_PATH ? { fontFilePath: env.FFMPEG_FONT_PATH } : {}),
  });
}
