import { readFile } from 'node:fs/promises';

const path = process.argv[2];

try {
  if (!path) throw new Error('audit result path is required');
  const report = JSON.parse(await readFile(path, 'utf8'));
  const vulnerabilities = report?.metadata?.vulnerabilities;
  const levels = ['critical', 'high', 'moderate', 'low'];
  if (
    !vulnerabilities ||
    levels.some((level) => !Number.isInteger(vulnerabilities[level]))
  ) {
    throw new Error('audit result is missing vulnerability counts');
  }

  const summary = levels
    .map((level) => `${level}=${vulnerabilities[level]}`)
    .join(' ');
  if (vulnerabilities.critical > 0 || vulnerabilities.high > 0) {
    console.error(`Production dependency audit blocked release: ${summary}`);
    const advisories = Object.values(report.advisories ?? {})
      .filter(
        (advisory) =>
          advisory?.severity === 'critical' || advisory?.severity === 'high'
      )
      .sort((left, right) => {
        if (left.severity !== right.severity) {
          return left.severity === 'critical' ? -1 : 1;
        }
        return String(left.module_name).localeCompare(
          String(right.module_name)
        );
      });
    for (const advisory of advisories) {
      const versions = [
        ...new Set(
          (advisory.findings ?? [])
            .map((finding) => finding.version)
            .filter(Boolean)
        ),
      ].join(',');
      const paths = [
        ...new Set(
          (advisory.findings ?? []).flatMap((finding) => finding.paths ?? [])
        ),
      ].join(' | ');
      console.error(
        `${advisory.severity} ${advisory.module_name}@${versions || 'unknown'} ${advisory.github_advisory_id || 'advisory-id-unavailable'}: ${advisory.recommendation || 'no fix recommendation'}; path=${paths || 'dependency path unavailable'}`
      );
    }
    process.exitCode = 1;
  } else {
    console.log(`Production dependency audit passed: ${summary}`);
  }
} catch (error) {
  console.error(
    'Unable to verify production dependency audit:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
}
