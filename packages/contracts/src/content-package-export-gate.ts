/**
 * Export preconditions for a ContentPackage — the single cross-tier authority.
 *
 * Until 2026-08-12 these two rules were transcribed three times: Core's
 * assertContentPackageExportAllowed (throwing twin), the works projection's
 * workExportability and the result center's canExportFullPackage — none
 * sharing a declaration, all Core's rules by the shell's own comment
 * ("Two rules, both of them core's"). Both tiers now consume this module;
 * platform/asset sufficiency checks remain per-surface concerns on top.
 */

/** Revoked rights or a needs_replacement package block every new export. */
export function contentPackageExportBlocked(contentPackage: {
  rights: { state: string };
  status: string;
}): boolean {
  return (
    contentPackage.rights.state === 'revoked' ||
    contentPackage.status === 'needs_replacement'
  );
}

/** Only an adopted 成品 (or a failed export being retried) may export. */
export function contentPackageExportEligibleStatus(status: string): boolean {
  return status === 'accepted' || status === 'export_failed';
}
