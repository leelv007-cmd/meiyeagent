import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordedFixtureVideoQualityScorer } from './index.js';

function asset(recorded: boolean) {
  return {
    contentType: 'video/mp4' as const,
    id: recorded ? 'recorded-video' : 'live-video',
    objectKey: 'workspace-a/owned/video.mp4',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    ...(recorded ? { sourceTaskRef: 'recorded-task-fixture-a' } : {}),
    technicalValidation: {
      codec: 'h264' as const,
      durationSeconds: 4,
      evidenceKind: recorded
        ? ('recorded_synthetic' as const)
        : ('measured' as const),
      playable: true,
    },
  };
}

test('ranks only recorded synthetic candidates with the checked-in fixture evaluation set', async () => {
  const scorer = new RecordedFixtureVideoQualityScorer();
  const base = {
    asset: asset(true),
    priorSelectedAssets: [],
    peerCandidateAssets: [],
    prompt: '门店开场',
    shotId: 'opening',
    storyboardRevision: 'storyboard-a',
    workflowId: 'workflow-a',
    workspaceId: 'workspace-a',
  };
  const first = await scorer.score({ ...base, candidateIndex: 0 });
  const second = await scorer.score({ ...base, candidateIndex: 1 });
  assert.equal(first.calibration, 'recorded_human_fixture');
  assert.ok(first.score > second.score);
  assert.equal(
    first.calibrationEvidence.datasetRevision,
    'recorded-e2e-video-quality-v1'
  );

  const live = await scorer.score({
    ...base,
    asset: asset(false),
    candidateIndex: 0,
  });
  assert.equal(live.calibration, 'unscored_requires_human_review');
});
