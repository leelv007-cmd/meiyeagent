import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const rulesetPath = join(repositoryRoot, 'docs/ops/branch-protection-ruleset.json');
const scriptPath = join(repositoryRoot, 'scripts/ops/apply-branch-protection.sh');

async function readRuleset() {
  return JSON.parse(await readFile(rulesetPath, 'utf8'));
}

/** Runs the script with a `gh` stub on PATH that records every invocation. */
async function runScript(args, { ghOutput = '' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-branch-protection-'));
  const logPath = join(directory, 'gh.log');
  const stubPath = join(directory, 'gh');
  await writeFile(
    stubPath,
    `#!/usr/bin/env bash
printf 'gh' >> '${logPath}'
printf ' %s' "$@" >> '${logPath}'
printf '\\n' >> '${logPath}'
printf '%s' '${ghOutput}'
`
  );
  await chmod(stubPath, 0o755);

  const result = spawnSync('/bin/bash', [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    },
  });
  const calls = existsSync(logPath)
    ? (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean)
    : [];
  return { calls, result };
}

test('the ruleset protects the default branch with no bypass actors', async () => {
  const ruleset = await readRuleset();
  assert.equal(ruleset.name, 'main-release-gate');
  assert.equal(ruleset.target, 'branch');
  assert.equal(ruleset.enforcement, 'active');
  assert.deepEqual(ruleset.bypass_actors, []);
  assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const types = ruleset.rules.map((rule) => rule.type).sort();
  assert.deepEqual(types, [
    'deletion',
    'non_fast_forward',
    'pull_request',
    'required_status_checks',
  ]);
});

test('the single required context is the aggregation job that covers all four gates', async () => {
  const ruleset = await readRuleset();
  const rule = ruleset.rules.find((entry) => entry.type === 'required_status_checks');
  assert.deepEqual(
    rule.parameters.required_status_checks.map((check) => check.context),
    ['required']
  );

  const workflow = await readFile(
    join(repositoryRoot, '.github/workflows/core-quality.yml'),
    'utf8'
  );
  assert.match(workflow, /^ {2}required:/m);
  // T04 assembly gate and T37 browser hard gate ride one job; SCA and the eval
  // gate are their own jobs. The aggregation job needs every one of them.
  for (const job of [
    'production-main-journey',
    'p2-browser-acceptance',
    'production-dependency-audit',
    'redline-evals',
    'core',
    'root-quality',
    'core-persistence',
  ]) {
    assert.match(workflow, new RegExp(`^ {2}${job}:`, 'm'));
    assert.match(workflow, new RegExp(`needs\\.${job}\\.result`));
  }
});

test('the apply script defaults to a dry run that calls GitHub zero times', async () => {
  const { calls, result } = await runScript(['--repo', 'owner/name']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, []);
  assert.match(result.stdout, /Required contexts: required/);
  assert.match(result.stdout, /every required context exists as a job/);
  assert.match(result.stdout, /Dry run: no GitHub call was made/);
  assert.match(result.stdout, /gh api repos\/owner\/name\/rulesets/);
});

test('--apply creates the ruleset when absent and updates it in place when present', async () => {
  const created = await runScript(['--apply', '--repo', 'owner/name']);
  assert.equal(created.result.status, 0, created.result.stderr);
  assert.match(created.result.stdout, /Creating ruleset main-release-gate/);
  assert.deepEqual(created.calls, [
    'gh api repos/owner/name/rulesets --jq .[] | select(.name=="main-release-gate") | .id',
    'gh api --method POST repos/owner/name/rulesets --input docs/ops/branch-protection-ruleset.json',
    'gh api repos/owner/name/rulesets --jq .[] | {id, name, target, enforcement}',
  ]);

  const updated = await runScript(['--apply', '--repo', 'owner/name'], {
    ghOutput: '4242',
  });
  assert.equal(updated.result.status, 0, updated.result.stderr);
  assert.match(updated.result.stdout, /Updating existing ruleset 4242/);
  assert.ok(
    updated.calls.some(
      (call) =>
        call ===
        'gh api --method PUT repos/owner/name/rulesets/4242 --input docs/ops/branch-protection-ruleset.json'
    ),
    updated.calls.join('\n')
  );
});

test('a required context that is not a real job refuses to apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-branch-protection-bad-'));
  const badRuleset = join(directory, 'ruleset.json');
  const ruleset = await readRuleset();
  for (const rule of ruleset.rules) {
    if (rule.type === 'required_status_checks') {
      rule.parameters.required_status_checks = [{ context: 'assembly-gate' }];
    }
  }
  await writeFile(badRuleset, JSON.stringify(ruleset));

  const { calls, result } = await runScript([
    '--apply',
    '--repo',
    'owner/name',
    '--ruleset',
    badRuleset,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Required context 'assembly-gate' is not a job/);
  assert.deepEqual(calls, []);
});
