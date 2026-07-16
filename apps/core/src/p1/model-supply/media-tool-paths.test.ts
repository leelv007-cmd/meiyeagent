import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFfmpegPath, resolveFfprobePath } from './media-tool-paths.js';

test('media tools use PATH defaults unless deployment paths are explicit', () => {
  assert.equal(resolveFfmpegPath({}), 'ffmpeg');
  assert.equal(resolveFfprobePath({}), 'ffprobe');
  assert.equal(
    resolveFfmpegPath({ FFMPEG_PATH: '/runtime/bin/ffmpeg' }),
    '/runtime/bin/ffmpeg'
  );
  assert.equal(
    resolveFfprobePath({ FFPROBE_PATH: '/runtime/bin/ffprobe' }),
    '/runtime/bin/ffprobe'
  );
});
