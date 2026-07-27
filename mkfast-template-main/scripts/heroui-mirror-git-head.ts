import { execFileSync } from 'node:child_process';

export function verifyHeroUiMirrorGitHead(input: {
  mirror: string;
  pinnedCommit: string;
}) {
  const pinnedCommit = input.pinnedCommit.trim().toLowerCase();
  if (!/^[a-f0-9]{7,40}$/u.test(pinnedCommit)) {
    throw new Error(
      `HeroUI mirror pin must be a 7-40 character Git commit, received ${input.pinnedCommit}.`
    );
  }

  let head: string;
  try {
    head = execFileSync(
      'git',
      ['-C', input.mirror, 'rev-parse', '--verify', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
      .trim()
      .toLowerCase();
  } catch {
    throw new Error(
      `HeroUI mirror at ${input.mirror} is not a readable Git checkout.`
    );
  }

  if (!head.startsWith(pinnedCommit)) {
    throw new Error(
      `HeroUI mirror HEAD ${head} does not match pinned commit ${pinnedCommit}.`
    );
  }
  return head;
}
