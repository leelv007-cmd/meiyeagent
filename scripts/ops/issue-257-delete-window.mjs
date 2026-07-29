#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTROLLER_PREFIX = /^(?:主控通告|主控裁决)/u;
const OPEN_MARKERS = [
  /#257 删除窗口现已开启/u,
  /删除窗口.{0,20}开启/u,
  /修完即开工/u,
];
const CLOSED_MARKERS = [
  /删除窗口(?:现已|已)?关闭/u,
  /窗口关闭/u,
  /维持待命/u,
  /暂停执行/u,
];

function blocker(code, detail) {
  return { code, detail };
}

export function controllerWindowDecision(comments) {
  const latest =
    comments
      .filter(
        (comment) =>
          typeof comment?.body === 'string' &&
          CONTROLLER_PREFIX.test(comment.body),
      )
      .at(-1) ?? null;
  if (!latest) {
    return {
      commentCreatedAt: null,
      state: 'missing',
    };
  }

  const body = latest.body;
  const closed = CLOSED_MARKERS.some((pattern) => pattern.test(body));
  const open = OPEN_MARKERS.some((pattern) => pattern.test(body));
  return {
    commentCreatedAt:
      typeof latest.createdAt === 'string' ? latest.createdAt : null,
    state: closed ? 'closed' : open ? 'open' : 'undecided',
  };
}

export function evaluateDeleteWindow({
  candidateClean,
  candidateContainsMain,
  controllerDecision,
}) {
  const blockers = [];
  if (controllerDecision.state !== 'open') {
    blockers.push(
      blocker(
        'controller_window_closed',
        `latest controller decision is ${controllerDecision.state}`,
      ),
    );
  }
  if (!candidateClean) {
    blockers.push(
      blocker('candidate_dirty', 'commit or remove Issue 257 lane changes first'),
    );
  }
  if (!candidateContainsMain) {
    blockers.push(
      blocker('candidate_stale', 'rebase the Issue 257 lane onto latest main'),
    );
  }
  return {
    blockers,
    controllerCommentCreatedAt: controllerDecision.commentCreatedAt,
    controllerWindowState: controllerDecision.state,
    ready: blockers.length === 0,
  };
}

export function evaluateStableDeleteWindow({ first, second }) {
  if (!first.result.ready) return first.result;
  if (!second.result.ready) return second.result;
  if (first.mainHead !== second.mainHead) {
    return {
      ...second.result,
      blockers: [
        blocker(
          'main_changed',
          `main changed from ${first.mainHead} to ${second.mainHead}`,
        ),
      ],
      ready: false,
    };
  }
  if (first.candidateHead !== second.candidateHead) {
    return {
      ...second.result,
      blockers: [
        blocker(
          'candidate_changed',
          `candidate changed from ${first.candidateHead} to ${second.candidateHead}`,
        ),
      ],
      ready: false,
    };
  }
  if (
    first.result.controllerCommentCreatedAt !==
    second.result.controllerCommentCreatedAt
  ) {
    return {
      ...second.result,
      blockers: [
        blocker(
          'controller_changed',
          'controller decision changed during the stability window',
        ),
      ],
      ready: false,
    };
  }
  return second.result;
}

function git(args, cwd) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isAncestor(repository, ancestor, descendant) {
  return (
    spawnSync(
      'git',
      ['-C', repository, 'merge-base', '--is-ancestor', ancestor, descendant],
      { stdio: 'ignore' },
    ).status === 0
  );
}

function parseWorktrees(output) {
  return output
    .trim()
    .split(/\n\n+/u)
    .filter(Boolean)
    .map((record) => {
      const fields = new Map();
      for (const line of record.split('\n')) {
        const separator = line.indexOf(' ');
        const key = separator === -1 ? line : line.slice(0, separator);
        const value = separator === -1 ? '' : line.slice(separator + 1);
        fields.set(key, value);
      }
      return {
        branch: fields.get('branch') ?? '(detached)',
        path: resolve(fields.get('worktree') ?? ''),
      };
    });
}

function issueComments() {
  const output = execFileSync(
    'gh',
    ['issue', 'view', '257', '--json', 'comments'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(output).comments ?? [];
}

export function collectDeleteWindowState(candidatePath = process.cwd()) {
  const candidate = resolve(
    git(['rev-parse', '--show-toplevel'], candidatePath),
  );
  const worktrees = parseWorktrees(
    git(['worktree', 'list', '--porcelain'], candidate),
  );
  const mainPath =
    worktrees.find((worktree) => worktree.branch === 'refs/heads/main')?.path ??
    candidate;
  const mainHead = git(['rev-parse', 'HEAD'], mainPath);
  const candidateHead = git(['rev-parse', 'HEAD'], candidate);
  const controllerDecision = controllerWindowDecision(issueComments());
  const result = evaluateDeleteWindow({
    candidateClean:
      git(['status', '--porcelain=v1', '--untracked-files=all'], candidate)
        .length === 0,
    candidateContainsMain: isAncestor(candidate, mainHead, candidateHead),
    controllerDecision,
  });
  return {
    candidateHead,
    mainHead,
    result,
  };
}

export function formatDeleteWindow(result) {
  const lines = [
    result.ready
      ? 'Issue 257 delete window: READY'
      : 'Issue 257 delete window: BLOCKED',
    `- [controller_window] ${result.controllerWindowState}`,
  ];
  for (const entry of result.blockers) {
    lines.push(`- [${entry.code}] ${entry.detail}`);
  }
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const stableIndex = argv.indexOf('--stable-ms');
  const stableMs =
    stableIndex === -1 ? 3_000 : Number(argv[stableIndex + 1]);
  if (!Number.isFinite(stableMs) || stableMs < 0 || stableMs > 60_000) {
    throw new Error('--stable-ms must be between 0 and 60000');
  }

  const first = collectDeleteWindowState();
  let result = first.result;
  if (result.ready) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, stableMs));
    const second = collectDeleteWindowState();
    result = evaluateStableDeleteWindow({ first, second });
  }

  process.stdout.write(
    `${argv.includes('--json') ? JSON.stringify(result, null, 2) : formatDeleteWindow(result)}\n`,
  );
  process.exitCode = result.ready ? 0 : 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (invokedPath === import.meta.url) await main();
