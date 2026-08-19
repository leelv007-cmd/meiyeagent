import { fileURLToPath } from 'node:url';

// CI-03: merge-required is only blocking jobs. Advisory telemetry is listed so
// callers and tests can prove a red there never fails this aggregate.
export const MERGE_REQUIRED_JOBS = Object.freeze([
  ['redline-evals', 'REQUIRED_REDLINE_EVALS_RESULT'],
  ['core', 'REQUIRED_CORE_RESULT'],
  // V31-08 Session Quick Checks zero-LLM behavior gates (§31.1b)
  ['session-quick-checks', 'REQUIRED_SESSION_QUICK_CHECKS_RESULT'],
  ['root-quality', 'REQUIRED_ROOT_QUALITY_RESULT'],
  ['core-persistence', 'REQUIRED_CORE_PERSISTENCE_RESULT'],
  ['persistence-instrument', 'REQUIRED_PERSISTENCE_INSTRUMENT_RESULT'],
  ['production-main-journey', 'REQUIRED_PRODUCTION_MAIN_JOURNEY_RESULT'],
  // Gate shrink (2026-08-14): the day-0 release gate is the only required V3.1
  // browser verdict; p2-browser-acceptance and v31-browser-report are telemetry.
  ['v31-day0-gate', 'REQUIRED_V31_DAY0_GATE_RESULT'],
  [
    'production-dependency-audit',
    'REQUIRED_PRODUCTION_DEPENDENCY_AUDIT_RESULT',
  ],
]);

export const ADVISORY_TELEMETRY_JOBS = Object.freeze([
  ['p2-browser-acceptance', 'ADVISORY_P2_BROWSER_ACCEPTANCE_RESULT'],
  ['v31-browser-report', 'ADVISORY_V31_BROWSER_REPORT_RESULT'],
]);

export function jobNames(jobs) {
  return jobs.map(([jobName]) => jobName);
}

export function classifyJobResults(environment = process.env) {
  const blockingFailures = MERGE_REQUIRED_JOBS.flatMap(
    ([jobName, environmentKey]) => {
      const result = environment[environmentKey];
      return result === 'success'
        ? []
        : [`${jobName}: ${result || `<missing ${environmentKey}>`}`];
    }
  );
  const advisoryFailures = ADVISORY_TELEMETRY_JOBS.flatMap(
    ([jobName, environmentKey]) => {
      const result = environment[environmentKey];
      return result && result !== 'success' ? [`${jobName}: ${result}`] : [];
    }
  );
  return { blockingFailures, advisoryFailures };
}

export function aggregateMergeRequired(environment = process.env) {
  const { blockingFailures, advisoryFailures } = classifyJobResults(
    environment
  );
  return {
    mergeRequired: blockingFailures.length === 0,
    blockingFailures,
    advisoryFailures,
  };
}

export function formatAggregateReport({
  blockingFailures,
  advisoryFailures,
}) {
  const sections = [];
  if (advisoryFailures.length > 0) {
    sections.push(
      `Advisory telemetry red (does not block merge-required):\n${advisoryFailures
        .map((failure) => `- ${failure}`)
        .join('\n')}`
    );
  }
  if (blockingFailures.length > 0) {
    sections.push(
      `Required job aggregation failed:\n${blockingFailures
        .map((failure) => `- ${failure}`)
        .join('\n')}`
    );
  } else {
    sections.push('All merge-required jobs succeeded.');
  }
  return `${sections.join('\n')}\n`;
}

function main() {
  const verdict = aggregateMergeRequired();
  const report = formatAggregateReport(verdict);
  if (verdict.mergeRequired) {
    process.stdout.write(report);
    return;
  }
  process.stderr.write(report);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
