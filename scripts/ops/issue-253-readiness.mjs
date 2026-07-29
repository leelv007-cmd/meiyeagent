#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const dependencies = {
  '248': {
    issue: 248,
    scope: /^(apps\/core\/src\/|packages\/contracts\/src\/|mkfast-template-main\/src\/)/u,
  },
  '261': { issue: 261, scope: /^mkfast-template-main\/src\//u },
  '264FE': { issue: 264, scope: /^mkfast-template-main\/src\//u },
};

function args(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') options.json = true;
    else if (argument === '--help') options.help = true;
    else if (argument === '--markers' || argument === '--issue-fixtures') {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a path`);
      options[argument === '--markers' ? 'markers' : 'fixtures'] = resolve(value);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { encoding: 'utf8' });
}

function git(...commandArgs) {
  return run('git', commandArgs);
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function commit(revision) {
  const result = git('rev-parse', '--verify', `${revision}^{commit}`);
  return result.status === 0 ? result.stdout.trim() : null;
}

function pathsAtCommit(sha) {
  return git(
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    sha
  )
    .stdout.split('\n')
    .filter(Boolean);
}

function issue(options, number) {
  try {
    const data = options.fixtures
      ? json(resolve(options.fixtures, `${number}.json`))
      : JSON.parse(
          run('gh', [
            'issue',
            'view',
            String(number),
            '--json',
            'number,title,state,url,comments',
          ]).stdout
        );
    return {
      latestComment: data.comments?.at(-1) ?? null,
      number,
      state: data.state,
      status: 'available',
      title: data.title,
      url: data.url,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      number,
      state: 'UNKNOWN',
      status: 'unavailable',
    };
  }
}

function checkCurrentTree(mainSha, check) {
  const gaps = [];
  const exists =
    git('cat-file', '-e', `${mainSha}:${check.path}`).status === 0;
  if (check.exists === false) {
    if (exists) gaps.push(`${check.path} must be absent from current main`);
    return gaps;
  }
  if (!exists) return [`${check.path} is missing from current main`];
  const text = git('show', `${mainSha}:${check.path}`).stdout;
  for (const value of check.contains ?? []) {
    if (!text.includes(value)) gaps.push(`${check.path} must contain ${value}`);
  }
  for (const value of check.notContains ?? []) {
    if (text.includes(value)) gaps.push(`${check.path} must not contain ${value}`);
  }
  return gaps;
}

function inspect(mainSha, id, marker) {
  const { scope } = dependencies[id];
  const gaps = [];
  if (!marker) {
    return { commands: [], gaps: ['marker is required'], status: 'invalid_marker' };
  }
  const commands = marker?.acceptanceCommands ?? [];
  const ownedPaths = marker?.ownedPaths ?? [];
  const treeChecks = marker?.currentTreeChecks ?? [];
  if (!marker?.commit) gaps.push('commit is required');
  if (
    !Array.isArray(commands) ||
    commands.length === 0 ||
    commands.some(
      (command) => typeof command !== 'string' || command.trim().length === 0
    )
  ) {
    gaps.push('acceptanceCommands must not be empty');
  }
  if (!Array.isArray(ownedPaths) || ownedPaths.length === 0) {
    gaps.push('ownedPaths must not be empty');
  }
  if (!Array.isArray(treeChecks) || treeChecks.length === 0) {
    gaps.push('currentTreeChecks must not be empty');
  }
  if (
    treeChecks.some((check) =>
      [...(check.contains ?? []), ...(check.notContains ?? [])].some(
        (value) => typeof value !== 'string' || value.trim().length === 0
      )
    )
  ) {
    gaps.push('currentTreeChecks predicates must not be blank');
  }
  if (
    [...ownedPaths, ...treeChecks.map((check) => check.path)].some(
      (path) => typeof path !== 'string' || !scope.test(path)
    )
  ) {
    gaps.push('marker path is outside the dependency scope');
  }
  const covers = (path, owner) =>
    path === owner || path.startsWith(`${owner}/`);
  if (
    treeChecks.some(
      (check) => !ownedPaths.some((ownedPath) => covers(check.path, ownedPath))
    ) ||
    ownedPaths.some(
      (ownedPath) => !treeChecks.some((check) => covers(check.path, ownedPath))
    )
  ) {
    gaps.push('currentTreeChecks must cover ownedPaths');
  }
  const hasSemanticCheck =
    id === '264FE'
      ? treeChecks.some(
          (check) => check.exists === false || check.notContains?.length > 0
        )
      : treeChecks.some((check) => check.contains?.length > 0);
  if (!hasSemanticCheck) gaps.push('currentTreeChecks lacks a semantic predicate');
  if (gaps.length > 0) return { commands, gaps, status: 'invalid_marker' };

  const sha = commit(marker.commit);
  if (!sha) return { commands, gaps: ['commit cannot be resolved'], status: 'invalid_marker' };
  if (git('merge-base', '--is-ancestor', sha, mainSha).status !== 0) {
    return { commands, gaps: [`${sha} is not in local main`], sha, status: 'not_merged' };
  }
  const changedPaths = pathsAtCommit(sha);
  if (
    !ownedPaths.every((ownedPath) =>
      changedPaths.some(
        (path) => path === ownedPath || path.startsWith(`${ownedPath}/`)
      )
    )
  ) {
    gaps.push('marker commit does not change every ownedPath');
  }
  for (const check of treeChecks) {
    gaps.push(...checkCurrentTree(mainSha, check));
  }
  return {
    changedPaths,
    commands,
    gaps,
    ownedPaths,
    sha,
    status: gaps.length === 0 ? 'merged' : 'current_tree_mismatch',
  };
}

function report(options) {
  const mainSha = commit('main');
  const gaps = mainSha ? [] : ['local main cannot be resolved'];
  let markers = {};
  try {
    markers = json(options.markers).dependencies;
  } catch {
    gaps.push('--markers must point to readable JSON');
  }
  const issues = Object.fromEntries(
    [253, 248, 261, 264].map((number) => [number, issue(options, number)])
  );
  for (const value of Object.values(issues)) {
    if (value.status !== 'available') gaps.push(`issue #${value.number} is unavailable`);
  }
  const results = Object.entries(dependencies).map(([id, dependency]) => {
    const evidence = mainSha
      ? inspect(mainSha, id, markers?.[id])
      : { commands: [], gaps: ['local main unavailable'], status: 'unavailable' };
    gaps.push(...evidence.gaps.map((gap) => `${id}: ${gap}`));
    return { evidence, id, issue: issues[dependency.issue] };
  });
  return {
    dependencies: results,
    gaps,
    issues,
    main: mainSha,
    ready: gaps.length === 0,
    semanticRebase: {
      commands: results.flatMap((result) => result.evidence.commands),
      verification: results
        .filter((result) => result.evidence.sha)
        .map(
          (result) =>
            `git merge-base --is-ancestor ${result.evidence.sha} ${mainSha}`
        ),
    },
    target: '#253FE',
  };
}

function printHuman(result) {
  console.log(`ISSUE_253_FE_READY=${result.ready}`);
  console.log(`local_main=${result.main ?? 'unresolved'}`);
  for (const number of [253, 248, 261, 264]) {
    const value = result.issues[number];
    console.log(`#${number}: ${value.state}`);
    if (value.latestComment) {
      console.log(
        `  latest: ${value.latestComment.body.replace(/\s+/gu, ' ').slice(0, 180)}`
      );
    }
  }
  for (const dependency of result.dependencies) {
    console.log(`${dependency.id}: git=${dependency.evidence.status}`);
  }
  for (const gap of result.gaps) console.log(`GAP: ${gap}`);
  for (const command of result.semanticRebase.commands) {
    console.log(`SEMANTIC_REBASE: ${command}`);
  }
}

function help() {
  console.log(`Usage: pnpm ops:issue-253-readiness --markers <file> [--json]

Each dependency marker requires commit, ownedPaths, acceptanceCommands, and
currentTreeChecks. A currentTreeCheck has path plus exists:false, contains, or
notContains. The command only reads local main and GitHub issues #253/#248/#261/#264.`);
}

try {
  const options = args(process.argv.slice(2));
  if (options.help) help();
  else {
    const result = report(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
    process.exitCode = result.ready ? 0 : 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
