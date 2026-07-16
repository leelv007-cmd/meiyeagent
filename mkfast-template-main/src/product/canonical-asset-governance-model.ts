import type { Asset } from '@meiye/contracts';

export function isContentPackageEligibleAsset(asset: Asset) {
  return (
    asset.sourceType === 'real' &&
    asset.authorizationStatus === 'authorized' &&
    asset.consentScope !== 'internal_only' &&
    Boolean(asset.rightsEvidence?.trim())
  );
}

export function assetAuthorizationPresentation(asset: Asset): {
  action: 'authorize' | 'update_evidence' | 'none';
  status: Asset['authorizationStatus'];
} {
  const evidenceRequired = asset.sourceType === 'real';
  const evidenceRecorded = Boolean(asset.rightsEvidence?.trim());
  const publiclyUsable =
    asset.authorizationStatus === 'authorized' &&
    asset.consentScope !== 'internal_only' &&
    (!evidenceRequired || evidenceRecorded);

  if (asset.authorizationStatus === 'blocked') {
    return { action: 'none', status: 'blocked' };
  }
  if (asset.authorizationStatus === 'withdrawn') {
    return { action: 'none', status: 'withdrawn' };
  }
  if (publiclyUsable) {
    return {
      action: asset.sourceType === 'real' ? 'update_evidence' : 'none',
      status: 'authorized',
    };
  }
  return { action: 'authorize', status: 'pending' };
}
