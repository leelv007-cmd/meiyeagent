#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEPENDENCIES = [
  {
    id: '248',
    issue: 248,
    label: '#248 event contract',
    requiredPath: /^(apps\/core\/src\/|packages\/contracts\/src\/|mkfast-template-main\/src\/)/u,
  },
  {
    id: '261',
    issue: 261,
    label: '#261 Dashboard frontend',
    requiredPath: /^mkfast-template-main\/src\//u,
  },
  {
    id: '264FE',
    issue: 264,
    label: '#264 frontend retirement',
    requiredPath: /^mkfast-template-main\/src\//u,
  },
];

function parseArguments(argv) {
  const options = {
    json: false,
    main: 'main',
    repo: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const key = {
      '--issue-fixtures': 'issueFixtures',
      '--main': 'main',
      '--markers': 'markers',
      '--repo': 'repo',
    }[argument];
    if (!key) throw new Error(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  options.repo = resolve(options.repo);
  if (options.markers) options.markers = resolve(options.markers);
  if (options.issueFixtures) {
    options.issueFixtures = resolve(options.issueFixtures);
  }
  return options;
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
}

function runGit(repo, args) {
  return run('git', args, repo);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function resolveCommit(repo, revision) {
  const result = runGit(repo, ['rev-parse', '--verify', `${revision}^{commit}`]);
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function changedPaths(repo, commit) {
  const result = runGit(repo, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-only',
    '-r',
    commit,
  ]);
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean);
}

function commitSummary(repo, commit) {
  const result = runGit(repo, ['show', '-s', '--format=%H %s', commit]);
  return result.status === 0 ? result.stdout.trim() : commit;
}

function ownsChangedPath(changedPath, ownedPath) {
  return changedPath === ownedPath || changedPath.startsWith(`${ownedPath}/`);
}

function inspectGitEvidence(repo, main, dependency, marker) {
  const gaps = [];
  if (!marker || typeof marker !== 'object') {
    gaps.push(`missing explicit marker for ${dependency.label}`);
    return {
      acceptanceCommands: [],
      changedPaths: [],
      commit: null,
      gaps,
      ownedPaths: [],
      status: 'invalid_marker',
      summary: null,
    };
  }
  if (typeof marker.commit !== 'string' || marker.commit.trim().length === 0) {
    gaps.push(`${dependency.label} marker.commit is required`);
  }
  const acceptanceCommands = Array.isArray(marker.acceptanceCommands)
    ? marker.acceptanceCommands.filter(
        (command) => typeof command === 'string' && command.trim().length > 0
      )
    : [];
  if (acceptanceCommands.length === 0) {
    gaps.push(`${dependency.label} marker.acceptanceCommands must not be empty`);
  }
  const ownedPaths = Array.isArray(marker.ownedPaths)
    ? marker.ownedPaths.filter(
        (path) =>
          typeof path === 'string' &&
          path.trim().length > 0 &&
          !path.startsWith('/') &&
          !path.split('/').includes('..')
      )
    : [];
  if (ownedPaths.length === 0) {
    gaps.push(`${dependency.label} marker.ownedPaths must not be empty`);
  } else if (ownedPaths.some((path) => !dependency.requiredPath.test(path))) {
    gaps.push(`${dependency.label} marker.ownedPaths contains a path outside its scope`);
  }
  if (gaps.length > 0) {
    return {
      acceptanceCommands,
      changedPaths: [],
      commit: null,
      gaps,
      ownedPaths,
      status: 'invalid_marker',
      summary: null,
    };
  }

  const commit = resolveCommit(repo, marker.commit.trim());
  if (!commit) {
    gaps.push(`${dependency.label} marker commit cannot be resolved locally`);
    return {
      acceptanceCommands,
      changedPaths: [],
      commit: marker.commit.trim(),
      gaps,
      ownedPaths,
      status: 'unresolvable',
      summary: null,
    };
  }

  const ancestor = runGit(repo, [
    'merge-base',
    '--is-ancestor',
    commit,
    main,
  ]);
  const paths = changedPaths(repo, commit);
  if (ancestor.status !== 0) {
    gaps.push(`${dependency.label} marker ${commit} is not an ancestor of local ${main}`);
    return {
      acceptanceCommands,
      changedPaths: paths,
      commit,
      gaps,
      ownedPaths,
      status: 'not_merged',
      summary: commitSummary(repo, commit),
    };
  }
  if (paths.length === 0 || !paths.some((path) => dependency.requiredPath.test(path))) {
    gaps.push(
      `${dependency.label} marker ${commit} does not change a required product path`
    );
    return {
      acceptanceCommands,
      changedPaths: paths,
      commit,
      gaps,
      ownedPaths,
      status: 'scope_mismatch',
      summary: commitSummary(repo, commit),
    };
  }
  const missingOwnedPaths = ownedPaths.filter(
    (ownedPath) =>
      !paths.some((changedPath) => ownsChangedPath(changedPath, ownedPath))
  );
  if (missingOwnedPaths.length > 0) {
    gaps.push(
      `${dependency.label} marker commit does not change ownedPaths: ${missingOwnedPaths.join(
        ', '
      )}`
    );
    return {
      acceptanceCommands,
      changedPaths: paths,
      commit,
      gaps,
      ownedPaths,
      status: 'scope_mismatch',
      summary: commitSummary(repo, commit),
    };
  }
  return {
    acceptanceCommands,
    changedPaths: paths,
    commit,
    gaps,
    ownedPaths,
    status: 'merged',
    summary: commitSummary(repo, commit),
  };
}

function latestComment(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return null;
  return [...comments].sort((left, right) =>
    String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  ).at(-1);
}

function readIssue(options, number) {
  try {
    let issue;
    if (options.issueFixtures) {
      issue = readJson(resolve(options.issueFixtures, `${number}.json`));
    } else {
      const result = run(
        'gh',
        [
          'issue',
          'view',
          String(number),
          '--json',
          'number,title,state,closedAt,url,comments',
        ],
        options.repo
      );
      if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `gh exited ${result.status}`);
      }
      issue = JSON.parse(result.stdout);
    }
    return {
      closedAt: issue.closedAt ?? null,
      latestComment: latestComment(issue.comments),
      number: issue.number,
      state: issue.state,
      status: 'available',
      title: issue.title,
      url: issue.url,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      latestComment: null,
      number,
      state: 'UNKNOWN',
      status: 'unavailable',
    };
  }
}

export function checkIssue253Readiness(options) {
  const globalGaps = [];
  const mainCommit = resolveCommit(options.repo, options.main);
  if (!mainCommit) {
    globalGaps.push(`local main ref ${options.main} cannot be resolved`);
  }

  let markers = {};
  if (!options.markers) {
    globalGaps.push('--markers is required for fail-closed merge evidence');
  } else {
    try {
      markers = readJson(options.markers).dependencies ?? {};
    } catch (error) {
      globalGaps.push(
        `cannot read marker file ${options.markers}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const dependencies = DEPENDENCIES.map((dependency) => {
    const issue = readIssue(options, dependency.issue);
    const git = mainCommit
      ? inspectGitEvidence(
          options.repo,
          options.main,
          dependency,
          markers[dependency.id]
        )
      : {
          acceptanceCommands: [],
          changedPaths: [],
          commit: null,
          gaps: [`cannot inspect ${dependency.label} before local main resolves`],
          status: 'unavailable',
          summary: null,
        };
    const gaps = [...git.gaps];
    if (issue.status !== 'available') {
      gaps.push(
        `${dependency.label} issue status/comments unavailable: ${issue.error}`
      );
    }
    return {
      gaps,
      git,
      id: dependency.id,
      issue,
      label: dependency.label,
    };
  });

  const ready =
    globalGaps.length === 0 &&
    dependencies.every((dependency) => dependency.gaps.length === 0);
  return {
    dependencies,
    gaps: [
      ...globalGaps,
      ...dependencies.flatMap((dependency) => dependency.gaps),
    ],
    main: {
      commit: mainCommit,
      ref: options.main,
    },
    ready,
    schemaVersion: 1,
    semanticRebase: {
      commands: dependencies.flatMap(
        (dependency) => dependency.git.acceptanceCommands
      ),
      required: true,
      verification: dependencies
        .filter((dependency) => dependency.git.commit)
        .map(
          (dependency) =>
            `git merge-base --is-ancestor ${dependency.git.commit} ${options.main}`
        ),
    },
    target: '#253FE',
  };
}

function oneLine(value, maximum = 180) {
  const normalized = String(value).replace(/\s+/gu, ' ').trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

function printHuman(report) {
  console.log(`ISSUE_253_FE_READY=${report.ready}`);
  console.log(`local_main=${report.main.ref}@${report.main.commit ?? 'unresolved'}`);
  for (const dependency of report.dependencies) {
    console.log(
      `${dependency.id}: git=${dependency.git.status} issue=${dependency.issue.state}`
    );
    if (dependency.git.summary) {
      console.log(`  evidence: ${dependency.git.summary}`);
    }
    if (dependency.issue.latestComment) {
      console.log(
        `  latest comment: ${oneLine(dependency.issue.latestComment.body)}`
      );
    } else if (dependency.issue.status === 'available') {
      console.log('  latest comment: none');
    }
  }
  if (report.gaps.length > 0) {
    console.log('gaps:');
    for (const gap of report.gaps) console.log(`- ${gap}`);
  }
  console.log('first semantic rebase commands:');
  if (report.semanticRebase.commands.length === 0) {
    console.log('- none supplied; readiness remains blocked');
  } else {
    for (const command of report.semanticRebase.commands) {
      console.log(`- ${command}`);
    }
  }
  console.log('merge evidence verification:');
  if (report.semanticRebase.verification.length === 0) {
    console.log('- none');
  } else {
    for (const command of report.semanticRebase.verification) {
      console.log(`- ${command}`);
    }
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/ops/issue-253-readiness.mjs --markers <path> [options]

Options:
  --repo <path>             Repository to inspect (default: current directory)
  --main <ref>              Local integration ref (default: main)
  --markers <path>          Explicit merge evidence and semantic rebase commands
  --issue-fixtures <path>   Read <issue>.json fixtures instead of calling gh
  --json                    Emit machine-readable JSON

Marker schema:
  {
    "dependencies": {
      "248":   { "commit": "<sha>", "ownedPaths": ["<path>"], "acceptanceCommands": ["<command>"] },
      "261":   { "commit": "<sha>", "ownedPaths": ["<path>"], "acceptanceCommands": ["<command>"] },
      "264FE": { "commit": "<sha>", "ownedPaths": ["<path>"], "acceptanceCommands": ["<command>"] }
    }
  }

The command is read-only. Issue state is diagnostic only; each commit must be
reachable from local main and must change the dependency's product scope.`);
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exitCode = 0;
    } else {
      const report = checkIssue253Readiness(options);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printHuman(report);
      }
      process.exitCode = report.ready ? 0 : 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
