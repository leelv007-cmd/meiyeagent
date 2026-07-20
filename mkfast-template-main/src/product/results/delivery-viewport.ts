import { useSyncExternalStore } from 'react';

import type { DeliveryPanelTarget } from './delivery-b3-types';

export type DeliveryWorkspaceKind = 'copy' | 'image' | 'video';

export function deliveryViewportFromWidth(
  width: number,
): 'desktop' | 'mobile' {
  return width < 768 ? 'mobile' : 'desktop';
}

export function deliveryTargetForIntent(
  workspaceKind: DeliveryWorkspaceKind,
  intent: string,
): DeliveryPanelTarget {
  if (workspaceKind === 'video') return 'douyin';
  if (/朋友圈|wechat\s*moments/iu.test(intent)) return 'wechat_moments';
  return 'xiaohongshu';
}

function subscribeViewport(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const media = window.matchMedia('(max-width: 767px)');
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

function browserViewport(): 'desktop' | 'mobile' {
  if (typeof window === 'undefined') return 'desktop';
  return deliveryViewportFromWidth(window.innerWidth);
}

export function useDeliveryViewport(): 'desktop' | 'mobile' {
  return useSyncExternalStore(subscribeViewport, browserViewport, () => 'desktop');
}
