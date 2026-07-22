const requiredJobs = [
  ['redline-evals', 'REQUIRED_REDLINE_EVALS_RESULT'],
  ['core', 'REQUIRED_CORE_RESULT'],
  ['root-quality', 'REQUIRED_ROOT_QUALITY_RESULT'],
  ['core-persistence', 'REQUIRED_CORE_PERSISTENCE_RESULT'],
  ['production-main-journey', 'REQUIRED_PRODUCTION_MAIN_JOURNEY_RESULT'],
];

const failures = requiredJobs.flatMap(([jobName, environmentKey]) => {
  const result = process.env[environmentKey];
  return result === 'success'
    ? []
    : [`${jobName}: ${result || `<missing ${environmentKey}>`}`];
});

if (failures.length > 0) {
  process.stderr.write(
    `Required job aggregation failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join('\n')}\n`
  );
  process.exitCode = 1;
} else {
  process.stdout.write('All required jobs succeeded.\n');
}
