import {
  composerContentPackagePlatformSchema,
  type ComposerContentPackagePlatform,
  type ComposerDistributionTarget,
} from '@meiye/contracts';

export function composerDestinationContract(value: string | null | undefined): {
  contentPackagePlatform: ComposerContentPackagePlatform;
  distributionTarget: ComposerDistributionTarget;
} | null {
  const parsed = composerContentPackagePlatformSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    contentPackagePlatform: parsed.data,
    distributionTarget:
      parsed.data === 'wechat_moments' ? 'assisted_handoff' : 'export',
  };
}

export function composerDestinationCapability(
  target: ComposerDistributionTarget
) {
  if (target === 'assisted_handoff') return '生成后协办交接';
  if (target === 'manual_copy') return '生成后手动复制';
  if (target.startsWith('publish:')) return '生成后发布';
  return '生成后导出';
}
