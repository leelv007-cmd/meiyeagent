/**
 * Channel readiness labels for admin + user select pages (I4 / D-069).
 * Secondary ops and single-channel core ops must show single-channel/no-fallback.
 */
import type {
  MultiChannelPublishGateResult,
  MultiChannelReadinessStatus,
} from './types.js';

export const CHANNEL_LABEL = {
  multiChannelReady: 'multi-channel ready',
  singleChannelNoFallback: 'single-channel/no-fallback',
  notVerified: 'not_verified',
  blocked: 'blocked',
} as const;

export type ChannelLabelKey = keyof typeof CHANNEL_LABEL;

export function channelLabelForStatus(
  status: MultiChannelReadinessStatus,
): string {
  switch (status) {
    case 'multi_channel_ready':
      return CHANNEL_LABEL.multiChannelReady;
    case 'single_channel':
      return CHANNEL_LABEL.singleChannelNoFallback;
    case 'not_verified':
      return CHANNEL_LABEL.notVerified;
    case 'blocked':
      return CHANNEL_LABEL.blocked;
  }
}

/** Admin surface label (Chinese primary + English machine tag). */
export function adminChannelLabel(gate: MultiChannelPublishGateResult): string {
  if (gate.status === 'multi_channel_ready') {
    return gate.manufacturerIndependent
      ? '双渠道就绪（制造商级独立） · multi-channel ready'
      : '双渠道就绪（渠道级容灾） · multi-channel ready';
  }
  if (gate.status === 'single_channel') {
    return '单渠道 / 无回退 · single-channel/no-fallback';
  }
  if (gate.status === 'blocked') {
    return '无部署 · blocked';
  }
  return '未核验 · not_verified';
}

/** User model-select surface — keep short; always expose no-fallback when single. */
export function userSelectChannelLabel(
  gate: MultiChannelPublishGateResult,
): string {
  if (gate.status === 'multi_channel_ready') {
    return gate.manufacturerIndependent
      ? '双渠道保障'
      : '双渠道保障（渠道级）';
  }
  if (gate.status === 'single_channel') {
    return '单渠道 / 无回退';
  }
  return '供应未就绪';
}

export function isSingleChannelNoFallback(
  gate: MultiChannelPublishGateResult,
): boolean {
  return gate.status === 'single_channel';
}
