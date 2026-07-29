import { readFile } from 'node:fs/promises';

const reportPath = process.argv[2];
if (!reportPath) {
  throw new Error('Usage: node assert-core-persistence-ran.mjs <test-report|->');
}

const report =
  reportPath === '-'
    ? await readStandardInput()
    : await readFile(reportPath, 'utf8');
// The suite has 49 skips without persistence URLs and 6 with both URLs. If all
// 22 PostgreSQL tests regress to env-skipped, the total becomes 28, so 27 is
// the largest threshold that still catches that complete regression.
const maximumSkipped = Number(process.env.MAX_CORE_PERSISTENCE_SKIPS ?? 27);

if (!Number.isInteger(maximumSkipped) || maximumSkipped < 0) {
  throw new Error('MAX_CORE_PERSISTENCE_SKIPS must be a non-negative integer.');
}

const skippedMatches = [
  ...report.matchAll(/^(?:ℹ|#)\s*skipped\s+(\d+)\s*$/gmu),
];
if (skippedMatches.length === 0) {
  throw new Error('Core test output did not contain a skipped-test summary.');
}

const skipped = Number(skippedMatches.at(-1)[1]);
if (skipped > maximumSkipped) {
  throw new Error(
    `Core persistence gate expected at most ${maximumSkipped} skipped tests, got ${skipped}.`,
  );
}

const dbosSmokeName =
  'production DBOS registration launches and delivers one five-stage workflow';
const productionAssemblyJoinName =
  'production image media assembly durably joins admission to ContentPackage delivery';
// Only TAP/spec result prefixes count; TAP's preceding "# Subtest:" label is
// deliberately excluded even though it contains the same test name.
assertPassingResultLine(
  dbosSmokeName,
  'The DBOS registration smoke did not report a passing result.',
);
assertPassingResultLine(
  productionAssemblyJoinName,
  'The production media assembly join did not report a passing result.',
);

// TAP and spec place skip names and reasons differently, so parsing env names
// from a single line is not a reliable third defence. The reporter-independent
// combination above replaces it: the summary limit catches the 21 PostgreSQL
// env skips, while this explicit result-line check catches a skipped DBOS smoke.

console.log(
  `Core persistence gate passed: ${skipped} skipped tests, DBOS smoke executed, and production media assembly join executed.`,
);

function assertPassingResultLine(testName, failureMessage) {
  const resultLine = report
    .split(/\r?\n/u)
    .find((line) => {
      const result = line.trimStart();
      return (
        /^(?:ok\b|not ok\b|✔|✖)/u.test(result) &&
        result.includes(testName)
      );
    });
  if (
    !resultLine ||
    !/^(?:ok\b|✔)/u.test(resultLine.trimStart()) ||
    /\bSKIP\b/u.test(resultLine)
  ) {
    throw new Error(failureMessage);
  }
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
