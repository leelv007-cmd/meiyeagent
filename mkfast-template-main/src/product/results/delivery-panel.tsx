/**
 * Delivery panel surface (WT-D / #101).
 *
 * Capability-aware three groups; mobile full-height; four distinct outcomes.
 * Projection-driven — facts come from projectDeliveryPanel.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconShare,
  IconTransfer,
} from '@tabler/icons-react';
import type { DeliveryActionId } from './delivery-capability-groups';
import type { DeliveryPanelView } from './delivery-panel-model';
import type { DeliveryOutcome } from './delivery-outcomes-a11y';

export type DeliveryPanelProps = {
  view: DeliveryPanelView;
  onAction?: (actionId: DeliveryActionId) => void;
  /** Optional controlled outcome override for live region. */
  outcomeOverride?: DeliveryOutcome;
};

function actionIcon(id: DeliveryActionId) {
  switch (id) {
    case 'copy':
      return <IconCopy className="size-4" aria-hidden="true" />;
    case 'single_download':
    case 'full_package':
      return <IconDownload className="size-4" aria-hidden="true" />;
    case 'system_share':
      return <IconShare className="size-4" aria-hidden="true" />;
    case 'assisted':
      return <IconTransfer className="size-4" aria-hidden="true" />;
    default:
      return <IconCheck className="size-4" aria-hidden="true" />;
  }
}

export function DeliveryPanel({ view, onAction }: DeliveryPanelProps) {
  const fullHeight = view.surface.fullHeight;
  const outcome = view.outcome;

  return (
    <section
      data-testid={view.surface.testId}
      data-viewport={view.surface.viewport}
      data-full-height={fullHeight ? 'true' : 'false'}
      data-direct-publish-hidden={view.directPublishHidden ? 'true' : 'false'}
      className={
        fullHeight
          ? 'flex min-h-[100dvh] flex-col gap-4 p-4'
          : 'flex flex-col gap-4'
      }
      {...(fullHeight
        ? { 'data-mobile-surface': view.surface.mobileTestId }
        : {})}
      aria-label="交付面板"
    >
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-normal">交付</h2>
        <p className="text-sm text-muted-foreground">
          按设备与账号能力显示可用动作。复制、下载与交接不会被标成已发布。
        </p>
      </header>

      {/* Live region for four distinct outcomes */}
      <div
        id={view.liveRegionId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="delivery-panel-live"
      >
        {outcome?.announcement ?? ''}
      </div>

      {outcome ? (
        <div
          id={outcome.focusId}
          tabIndex={-1}
          role="status"
          data-testid={outcome.testId}
          data-outcome={outcome.outcome}
          data-platform-published={
            outcome.platformPublished ? 'true' : 'false'
          }
          className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
        >
          <IconCheck className="mr-1 inline size-4 text-emerald-700" />
          {outcome.announcement}
        </div>
      ) : null}

      {view.visibleGroups.map((group) => (
        <Card
          key={group.id}
          className="rounded-md shadow-none"
          data-testid={`delivery-group-${group.id}`}
          data-group-id={group.id}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{group.label}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {group.actions.map((action) => (
              <div key={action.id} className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant={action.id === 'full_package' ? 'default' : 'outline'}
                  disabled={!action.enabled}
                  data-testid={`delivery-action-${action.id}`}
                  data-action-id={action.id}
                  data-enabled={action.enabled ? 'true' : 'false'}
                  onClick={() => onAction?.(action.id)}
                  className="justify-start"
                >
                  {actionIcon(action.id)}
                  {action.label}
                </Button>
                {action.reason ? (
                  <p className="text-xs text-muted-foreground">{action.reason}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {view.assisted ? (
        <Card
          className="rounded-md shadow-none"
          data-testid="delivery-assisted-panel"
          data-status={view.assisted.status}
          data-published={view.assisted.isPublished ? 'true' : 'false'}
          data-handed-over={view.assisted.isHandedOver ? 'true' : 'false'}
          data-handed-over-not-published={
            view.assisted.handedOverIsNotPublished ? 'true' : 'false'
          }
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">辅助交接</CardTitle>
              <Badge
                variant={view.assisted.isPublished ? 'secondary' : 'outline'}
                data-testid="delivery-assisted-status"
              >
                {view.assisted.statusLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="space-y-1">
              <p className="font-medium">责任角色</p>
              <ul className="space-y-1 text-muted-foreground">
                {view.assisted.roleOptions.map((option) => (
                  <li
                    key={option.role}
                    data-testid={`delivery-role-${option.role}`}
                    data-selected={
                      view.assisted?.responsibilityRole === option.role
                        ? 'true'
                        : 'false'
                    }
                  >
                    {option.label}
                    {view.assisted?.responsibilityRole === option.role
                      ? '（当前）'
                      : ''}
                  </li>
                ))}
              </ul>
            </div>

            {view.assisted.pendingConfirm?.visible ? (
              <p
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs"
                data-testid="delivery-pending-confirm-24h"
                data-reason={view.assisted.pendingConfirm.reason}
              >
                {view.assisted.pendingConfirm.message}
              </p>
            ) : null}

            {view.assisted.handedOverIsNotPublished ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="delivery-handed-over-not-published"
              >
                已交接 ≠ 已发布。请在平台完成发布后回报结果。
              </p>
            ) : null}

            <Button
              type="button"
              disabled={!view.assisted.primaryCta.enabled}
              data-testid="delivery-assisted-cta"
              data-cta-id={view.assisted.primaryCta.id}
              onClick={() => onAction?.('assisted')}
            >
              {view.assisted.primaryCta.label}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {view.sharePlan ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="delivery-share-strategy"
          data-strategy={view.sharePlan.strategy}
        >
          分享策略：{view.sharePlan.strategy}
          {view.sharePlan.fallbacks.length > 0
            ? `（降级：${view.sharePlan.fallbacks.join(' → ')}）`
            : ''}
        </p>
      ) : null}
    </section>
  );
}
