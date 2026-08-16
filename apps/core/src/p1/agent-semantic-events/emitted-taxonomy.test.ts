import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AGENT_SEMANTIC_EVENT_TYPES,
  artifactTypeSchema,
} from '@meiye/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '../../../../..');

/**
 * Every semantic event type the workbench can render but nothing produces.
 *
 * The taxonomy is a seam with no module on the emitting side: the contract
 * declares fourteen types, the workbench builds an exhaustive `never`-checked
 * switch over all fourteen, and six of them are actually sent. The other eight
 * are not marked anywhere — they are simply absent, which is why
 * agent-event-reducer.ts has branches for `message.final` and `work.delivered`
 * that are written, tested, and unreachable. An absence cannot be reviewed;
 * a list can.
 *
 * A type belongs here only with a reason. Adding an emitter means deleting its
 * line, and deleting a type from the contract means deleting its line too —
 * either way the change is deliberate, which is the whole point.
 */
const NOT_EMITTED: Record<string, string> = {
  'run.started':
    'Run lifecycle is carried by the Run record itself; the workbench derives start from the first activity.snapshot.',
  'message.final':
    'No assistant-message surface exists upstream. agent-event-reducer.ts:545 appends to state.messages and can never run.',
  'goal.updated':
    'Goals are read through the goal-proactive module rather than streamed as revisions.',
  'memory.proposed':
    'Memory proposal is a panel action against Agent Memory, not part of the turn stream.',
  'memory.promoted':
    'Same as memory.proposed — promotion is a command result, never announced on the thread.',
  'work.waiting':
    'Waiting is inferred from activity.snapshot status; no separate event is produced.',
  'work.delivered':
    'Delivery is read from the result-delivery projection. agent-event-reducer.ts:638 dedupes on deliveryKey and can never run.',
  'outcome.recorded':
    'Outcome recording has no producer at all — the type is reserved by the contract only.',
};

/**
 * Same shape for artifact bodies: six declared, two emitted.
 * artifact-progress-emitter.ts is the only producer and it writes note/video.
 */
const ARTIFACT_NOT_EMITTED: Record<string, string> = {
  plan: 'The plan surface renders from plan.created/plan.revised payloads, not from an artifact body.',
  copy: 'Copy is delivered through the result-delivery projection rather than an artifact revision.',
  image: 'No image progress emitter exists; the media pipeline emits video only.',
  publish:
    'Publish handoff has its own projection; nothing writes a publish artifact body.',
};

const CORE_SOURCE_ROOT = join(repositoryRoot, 'apps/core/src');

/**
 * The AG-UI adapter is excluded because it translates rather than produces:
 * it names all fourteen types as case labels, so counting it would make every
 * type look emitted and this gate would assert nothing.
 */
const TRANSLATOR = 'apps/core/src/p1/agent-semantic-events/ag-ui-adapter.ts';

function productionTypescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      return [];
    }
    return [path];
  });
}

const producers = existsSync(CORE_SOURCE_ROOT)
  ? productionTypescriptFiles(CORE_SOURCE_ROOT)
      .map((path) => ({
        path: relative(repositoryRoot, path),
        source: readFileSync(path, 'utf8'),
      }))
      .filter((file) => file.path !== TRANSLATOR)
  : [];

function filesNaming(literal: string) {
  return producers
    .filter((file) => file.source.includes(literal))
    .map((file) => file.path)
    .sort();
}

test('every semantic event type is either emitted or listed as not emitted', () => {
  assert.ok(producers.length > 0, 'no production sources were scanned');
  const emitted: string[] = [];
  const silent: string[] = [];
  for (const type of AGENT_SEMANTIC_EVENT_TYPES) {
    (filesNaming(`'${type}'`).length > 0 ? emitted : silent).push(type);
  }

  // Both directions. A type that grows an emitter has to leave the list, and a
  // type that loses its last emitter has to join it — otherwise this gate would
  // only notice progress, never regression.
  assert.deepEqual(silent.sort(), Object.keys(NOT_EMITTED).sort());
  assert.equal(
    emitted.length + silent.length,
    AGENT_SEMANTIC_EVENT_TYPES.length
  );
  for (const [type, reason] of Object.entries(NOT_EMITTED)) {
    assert.ok(reason.length > 20, `${type} needs a real reason, not a label`);
  }
});

test('every artifact type is either emitted or listed as not emitted', () => {
  const emitted: string[] = [];
  const silent: string[] = [];
  for (const type of artifactTypeSchema.options) {
    (filesNaming(`artifactType: '${type}'`).length > 0 ? emitted : silent).push(
      type
    );
  }
  assert.deepEqual(silent.sort(), Object.keys(ARTIFACT_NOT_EMITTED).sort());
  assert.deepEqual(emitted.sort(), ['note', 'video']);
});
