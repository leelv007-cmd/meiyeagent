import {
  composerContentPackagePlatformSchema,
  composerDistributionTargetSchema,
  type ComposerContentPackagePlatform,
  type ComposerDistributionTarget,
} from '@meiye/contracts';

export function composerDestinationContract(
  value: string | null | undefined,
  target?: string | null
): {
  contentPackagePlatform: ComposerContentPackagePlatform;
  distributionTarget: ComposerDistributionTarget;
} | null {
  const parsed = composerContentPackagePlatformSchema.safeParse(value);
  if (!parsed.success) return null;
  const parsedTarget = composerDistributionTargetSchema.safeParse(target);
  return {
    contentPackagePlatform: parsed.data,
    distributionTarget:
      target == null
        ? parsed.data === 'wechat_moments'
          ? 'assisted_handoff'
          : 'export'
        : parsedTarget.success
          ? parsedTarget.data
          : 'export',
  };
}

export function composerDestinationCapability(
  target: ComposerDistributionTarget
) {
  if (target === 'assisted_handoff') return '生成后协办交接';
  if (target === 'manual_copy') return '生成后手动复制';
  return '生成后导出';
}
