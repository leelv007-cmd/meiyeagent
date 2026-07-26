import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path: string) =>
  readFile(new URL(path, import.meta.url), 'utf8');

test('Skill production runtime owns migration, command registration, and narrow stage resolution wiring', async () => {
  const [runtime, main, worker, stagePorts] = await Promise.all([
    source('./runtime.ts'),
    source('../../main.ts'),
    source('../../job-worker.ts'),
    source('../harness/production-stage-ports.ts'),
  ]);

  assert.match(runtime, /await repository\.migrate\(\)/u);
  assert.match(runtime, /new SkillFoundationModule\(service\)/u);
  assert.match(main, /createDurableSkillRuntime/u);
  assert.match(main, /skillRuntime\.foundationModule/u);
  assert.match(main, /skillRuntime\.instructionResolver/u);
  assert.ok(
    main.match(/skillRepository,/gu)?.length === 3,
    'main must register one repository in both migration lists and runtime assembly',
  );
  assert.match(worker, /skillRepository,/u);
  assert.doesNotMatch(stagePorts, /PostgresSkillRepository|new Pool|\bPool\b/u);
  assert.match(stagePorts, /HarnessSkillInstructionResolverPort/u);
});
