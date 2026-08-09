/**
 * Root manifest script contract.
 *
 * Two failure shapes this module exists to make impossible:
 *
 * 1. Bare binaries. The root workspace declares no devDependencies, so nothing
 *    is linked into root `node_modules/.bin`. A root script invoking a bare
 *    binary resolves only from whatever the author has installed globally:
 *    green on that machine, `command not found` in CI, and the required
 *    `root-quality` job goes red for a reason the author cannot reproduce.
 *    Observed: a lane added `test:journeys` = `tsx --test …` while `which tsx`
 *    resolved to a global `~/.npm-global/bin/tsx`.
 *
 * 2. Masked gate families. The script-gate suites are independent. Chaining a
 *    command ahead of them with `&&` makes every family after the failure point
 *    unreachable, so one broken step silently stops several gates from running
 *    while CI still reports a single red. The same commit did this too: the
 *    bare-binary script was spliced into the middle of the `&&` chain, putting
 *    every gate family behind it.
 *
 * Why the verdicts never look at what is installed
 * ------------------------------------------------
 * The obvious "improvement" here is to check whether the binary actually
 * resolves — probe `node_modules/.bin`, or shell out to `which`. Do not do it.
 * This gate exists because a command resolved on one machine and not another;
 * a gate whose own verdict depends on the machine reproduces the bug class it
 * was written to catch. It would pass on the laptop that has `tsx` globally —
 * precisely the laptop that introduced the bug — and it would fail on a fresh
 * checkout before `pnpm install`, where nothing is linked and every script
 * would look broken. Both failures are confusing in the same way the original
 * bug was confusing: the answer depends on who ran it.
 *
 * So the verdict is a closed allowlist of launchers, decided from the manifest
 * text alone. The `node_modules/.bin` probe in the test enriches the failure
 * message and never votes.
 *
 * Why this is root-only, and why widening it would be wrong
 * --------------------------------------------------------
 * The narrow scope is the point, not an oversight. Root is the special case
 * *because* it declares no devDependencies — a bare binary there can only come
 * from a machine-global install. Workspace packages (`apps/core`,
 * `mkfast-template-main`, `packages/*`) declare their own devDependencies and
 * get a populated `node_modules/.bin`, so a bare binary in their scripts is
 * legitimately resolvable and correct. Applying this rule to them would report
 * working scripts as violations, and the usual response to a gate that cries
 * wolf is to delete the gate. Reach workspace binaries from root the supported
 * way: `pnpm --filter <pkg> exec <binary>`.
 */

/**
 * `node` and `bash` are always present. `pnpm` is the CI-pinned package manager
 * and reaches workspace binaries via `pnpm --filter <pkg> exec <binary>`, where
 * the binary resolves from that workspace's own install.
 *
 * Derived from the launchers the existing root scripts already use. Closed list
 * on purpose — widening it belongs in the same commit as the script needing it.
 */
export const ALLOWED_COMMAND_HEADS = ['bash', 'node', 'pnpm'];

/**
 * The independent script-gate families. Adding one means adding an argument to
 * the single `node --test` invocation and to this list — never a separate
 * `&&` step.
 */
export const SCRIPT_GATE_FAMILIES = [
  // The CI gate contracts themselves, including this file's tests. Wired into
  // root `test` so a developer sees a broken gate locally instead of finding it
  // in CI, which is the slowest possible place to learn it. `root-quality`
  // already runs this family as its own step before the gates, so in CI it now
  // runs twice; that duplicate costs seconds and is not a reason to unregister
  // it here, because removing it takes the local run away with it.
  'scripts/ci/*.test.mjs',
  'scripts/dev/*.test.mjs',
  'scripts/uiux/*.test.mjs',
  'scripts/recovery/*.test.mjs',
  'scripts/ops/*.test.mjs',
  'scripts/polotno-retirement-gate.test.mjs',
];

export const REMEDIATION = [
  'Use one of:',
  '  node <script.mjs>',
  '  pnpm --filter <workspace> exec <binary> …   (binary from that workspace)',
  '  pnpm --filter <workspace> <script>',
  '  bash <script.sh>',
].join('\n');

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/u;

/**
 * Split a shell command on the operators that start a fresh command, leaving
 * quoted regions intact (root scripts pass quoted regexes to `pnpm -r run`,
 * e.g. `"/^dev(:worker)?$/"`).
 */
export function splitCommandSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (command.startsWith('&&', index) || command.startsWith('||', index)) {
      segments.push(current);
      current = '';
      index += 1;
      continue;
    }
    if (char === ';' || char === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  segments.push(current);

  return segments.map((segment) => segment.trim()).filter(Boolean);
}

/** The launched program, ignoring any `FOO=bar` prefixes. */
export function commandHead(segment) {
  const tokens = segment.split(/\s+/u);
  let index = 0;
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index])) {
    index += 1;
  }
  return tokens[index] ?? '';
}

/**
 * Every command head that is not an allowed launcher.
 *
 * `describeBin` is diagnostic only — it enriches the message with whether the
 * binary happens to be linked into the root install, and never changes the
 * verdict.
 */
export function bareCommandViolations(scripts, describeBin = () => null) {
  const allowed = new Set(ALLOWED_COMMAND_HEADS);
  const violations = [];

  for (const [name, command] of Object.entries(scripts)) {
    for (const segment of splitCommandSegments(command)) {
      const head = commandHead(segment);
      if (allowed.has(head)) continue;

      const note = describeBin(head);
      violations.push(
        `"${name}": bare command "${head}" in segment \`${segment}\`` +
          (note ? ` (${note})` : '')
      );
    }
  }

  return violations;
}

/**
 * Every way the root `test` script could let one step mask another, so that
 * every registered gate family keeps sharing a single unmaskable run.
 */
export function gateFamilyViolations(testScript) {
  const segments = splitCommandSegments(testScript ?? '');
  const violations = [];

  if (segments.length !== 2) {
    violations.push(
      `root "test" must stay two steps (recursive workspace tests, then one ` +
        `node --test run over every gate family); found ${segments.length}: ` +
        JSON.stringify(segments)
    );
    return violations;
  }

  if (segments[0] !== 'pnpm -r --if-present test') {
    violations.push(
      `first step must be \`pnpm -r --if-present test\`; found \`${segments[0]}\``
    );
  }

  const gateRun = segments[1];
  if (!gateRun.startsWith('node --test ')) {
    violations.push(
      `the gate families must be the final step under one node --test process; ` +
        `found \`${gateRun}\``
    );
    return violations;
  }

  const listed = gateRun.replace(/^node --test\s+/u, '').split(/\s+/u);
  const missing = SCRIPT_GATE_FAMILIES.filter(
    (family) => !listed.includes(family)
  );
  const unexpected = listed.filter(
    (entry) => !SCRIPT_GATE_FAMILIES.includes(entry)
  );

  if (missing.length > 0) {
    violations.push(`gate families missing from the run: ${missing.join(', ')}`);
  }
  if (unexpected.length > 0) {
    violations.push(
      `unregistered arguments in the gate run: ${unexpected.join(', ')} ` +
        `(add them to SCRIPT_GATE_FAMILIES deliberately)`
    );
  }

  return violations;
}
