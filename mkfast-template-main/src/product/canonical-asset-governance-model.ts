import {
  hasCurrentRestrictedAssetAuthorization,
  type Asset,
} from '@meiye/contracts';

export function isContentPackageEligibleAsset(asset: Asset, at = new Date()) {
  return (
    asset.sourceType === 'real' &&
    asset.authorizationStatus === 'authorized' &&
    asset.consentScope !== 'internal_only' &&
    Boolean(asset.rightsEvidence?.trim()) &&
    hasCurrentRestrictedAssetAuthorization(asset, at)
  );
}

export function assetAuthorizationPresentation(
  asset: Asset,
  at = new Date()
): {
  action: 'authorize' | 'update_evidence' | 'none';
  status: Asset['authorizationStatus'];
} {
  const evidenceRequired = asset.sourceType === 'real';
  const evidenceRecorded = Boolean(asset.rightsEvidence?.trim());
  const publiclyUsable =
    asset.authorizationStatus === 'authorized' &&
    asset.consentScope !== 'internal_only' &&
    (!evidenceRequired || evidenceRecorded) &&
    hasCurrentRestrictedAssetAuthorization(asset, at);

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
