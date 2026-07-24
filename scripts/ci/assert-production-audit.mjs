import { readFile } from 'node:fs/promises';

const [auditPath, waiverPath] = process.argv.slice(2);
const severityLevels = ['critical', 'high', 'moderate', 'low'];
const blockingSeverities = new Set(['critical', 'high']);

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${label} cannot be parsed: ${error instanceof Error ? error.message : error}`
    );
  }
}

function parseWaivers(document) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.waivers)) {
    throw new Error(
      'waiver manifest must contain schemaVersion=1 and a waivers array'
    );
  }

  const today =
    process.env.PRODUCTION_AUDIT_DATE ??
    new Date().toISOString().slice(0, 10);
  const waivers = new Map();
  for (const [index, waiver] of document.waivers.entries()) {
    const prefix = `waiver ${index + 1}`;
    if (
      typeof waiver?.advisoryId !== 'string' ||
      !/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/u.test(
        waiver.advisoryId
      )
    ) {
      throw new Error(`${prefix} has an invalid advisoryId`);
    }
    if (typeof waiver.reason !== 'string' || waiver.reason.trim() === '') {
      throw new Error(`${prefix} must include a reason`);
    }
    const expiration =
      typeof waiver.expiresOn === 'string'
        ? new Date(`${waiver.expiresOn}T00:00:00Z`)
        : undefined;
    if (
      !expiration ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(waiver.expiresOn) ||
      Number.isNaN(expiration.valueOf()) ||
      expiration.toISOString().slice(0, 10) !== waiver.expiresOn
    ) {
      throw new Error(`${prefix} has an invalid expiresOn date`);
    }
    if (waiver.expiresOn < today) {
      throw new Error(
        `${prefix} for ${waiver.advisoryId} expired on ${waiver.expiresOn}`
      );
    }
    if (waivers.has(waiver.advisoryId)) {
      throw new Error(`${prefix} duplicates ${waiver.advisoryId}`);
    }
    waivers.set(waiver.advisoryId, waiver);
  }
  return waivers;
}

try {
  if (!auditPath) throw new Error('audit result path is required');
  if (!waiverPath) throw new Error('waiver manifest path is required');

  const report = await readJson(auditPath, 'audit result');
  const waivers = parseWaivers(await readJson(waiverPath, 'waiver manifest'));
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (
    !vulnerabilities ||
    severityLevels.some(
      (level) =>
        !Number.isInteger(vulnerabilities[level]) ||
        vulnerabilities[level] < 0
    )
  ) {
    throw new Error('audit result is missing vulnerability counts');
  }

  const summary = severityLevels
    .map((level) => `${level}=${vulnerabilities[level]}`)
    .join(' ');
  const advisories = Object.values(report.advisories ?? {})
    .filter((advisory) => blockingSeverities.has(advisory?.severity))
    .sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity === 'critical' ? -1 : 1;
      }
      return String(left.github_advisory_id).localeCompare(
        String(right.github_advisory_id)
      );
    });
  if (
    (vulnerabilities.critical > 0 || vulnerabilities.high > 0) &&
    advisories.length === 0
  ) {
    throw new Error('audit result is missing blocking advisory details');
  }

  const blocked = advisories.filter(
    (advisory) => !waivers.has(advisory.github_advisory_id)
  );
  if (blocked.length > 0) {
    console.error(
      `Production dependency audit blocked release: ${summary} waived=${advisories.length - blocked.length} unwaived=${blocked.length}`
    );
    for (const advisory of blocked) {
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
    console.log(
      `Production dependency audit passed: ${summary} waived=${advisories.length} unwaived=0`
    );
  }
} catch (error) {
  console.error(
    'Unable to verify production dependency audit:',
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
}
