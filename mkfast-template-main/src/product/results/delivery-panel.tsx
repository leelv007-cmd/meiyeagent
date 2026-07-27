/**
 * Delivery panel surface (WT-D / #101).
 *
 * Capability-aware three groups; mobile full-height; four distinct outcomes.
 * Projection-driven — facts come from projectDeliveryPanel.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  result_full_package_heading,
  result_full_package_hint,
} from '@/locale/paraglide/messages';
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
import { projectDeliveryOutcome } from './delivery-outcomes-a11y';
import { useState } from 'react';
import type { AssistedResponsibilityRole } from './delivery-b3-types';

export type DeliveryPanelProps = {
  view: DeliveryPanelView;
  onAction?: (
    actionId: DeliveryActionId,
    assisted?: {
      ownerId?: string;
      responsibilityRole: AssistedResponsibilityRole;
    }
  ) => DeliveryOutcome | undefined | Promise<DeliveryOutcome | undefined>;
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

export function DeliveryPanel({
  view,
  onAction,
  outcomeOverride,
}: DeliveryPanelProps) {
  const [completedOutcome, setCompletedOutcome] =
    useState<DeliveryOutcome | null>(null);
  const [pendingAction, setPendingAction] = useState<DeliveryActionId | null>(
    null
  );
  const [responsibilityRole, setResponsibilityRole] =
    useState<AssistedResponsibilityRole>(
      view.assisted?.responsibilityRole ?? 'self_publish'
    );
  const [externalOwnerId, setExternalOwnerId] = useState('');
  const fullHeight = view.surface.fullHeight;
  const outcome = outcomeOverride
    ? projectDeliveryOutcome(outcomeOverride)
    : completedOutcome
      ? projectDeliveryOutcome(completedOutcome)
      : view.outcome;

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
      <output
        id={view.liveRegionId}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="delivery-panel-live"
      >
        {outcome?.announcement ?? ''}
      </output>

      {outcome ? (
        <output
          id={outcome.focusId}
          tabIndex={-1}
          data-testid={outcome.testId}
          data-outcome={outcome.outcome}
          data-platform-published={outcome.platformPublished ? 'true' : 'false'}
          className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
        >
          <IconCheck className="mr-1 inline size-4 text-emerald-700" />
          {outcome.announcement}
        </output>
      ) : null}

      {/*
        W09: the full package plan, on screen. `fullPackage` had no producer,
        so the merchant downloaded a ZIP whose contents were invisible until it
        was open on their desktop. The manifest already describes the layout —
        this states it before the download.
      */}
      {view.fullPackage ? (
        <section
          className="space-y-2 rounded-md border p-3"
          data-testid="delivery-full-package-plan"
          data-modality={view.fullPackage.modality}
          data-schema={view.fullPackage.schema}
          data-file-count={String(view.fullPackage.files.length)}
        >
          <h3 className="text-sm font-medium">
            {result_full_package_heading()}
          </h3>
          <p className="text-xs text-muted-foreground">
            {result_full_package_hint()}
          </p>
          {/*
            No file name here on purpose: the download is named by core's
            export receipt, and printing a second, locally derived name would
            be a promise the download does not keep.
          */}
          <ol className="space-y-1">
            {view.fullPackage.files.map((file) => (
              <li
                key={file.path}
                className="text-xs text-muted-foreground"
                data-testid="delivery-full-package-file"
                data-role={file.role}
              >
                {file.path}
              </li>
            ))}
          </ol>
          {view.fullPackage.segments ? (
            <ol className="space-y-1" data-testid="delivery-moments-segments">
              {view.fullPackage.segments.map((segment) => (
                <li
                  key={segment.id}
                  className="text-xs text-muted-foreground"
                  data-segment={segment.id}
                >
                  {segment.label}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
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
            {group.id === 'handoff_to_platform' ? (
              <div
                className="mb-2 space-y-2 rounded-md border p-3"
                data-testid="delivery-assisted-setup"
              >
                <p className="text-sm font-medium">发布责任人</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      responsibilityRole === 'self_publish'
                        ? 'default'
                        : 'outline'
                    }
                    data-testid="delivery-assisted-role-self_publish"
                    onClick={() => setResponsibilityRole('self_publish')}
                  >
                    本人发布
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      responsibilityRole === 'external_owner'
                        ? 'default'
                        : 'outline'
                    }
                    data-testid="delivery-assisted-role-external_owner"
                    onClick={() => setResponsibilityRole('external_owner')}
                  >
                    外部责任人
                  </Button>
                </div>
                {responsibilityRole === 'external_owner' ? (
                  <div className="space-y-1">
                    <Label htmlFor="delivery-assisted-owner-id">
                      外部责任人
                    </Label>
                    <Input
                      id="delivery-assisted-owner-id"
                      data-testid="delivery-assisted-owner-id"
                      value={externalOwnerId}
                      onChange={(event) =>
                        setExternalOwnerId(event.target.value)
                      }
                      placeholder="姓名或责任人标识"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {group.actions.map((action) => (
              <div key={action.id} className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant={action.id === 'full_package' ? 'default' : 'outline'}
                  disabled={
                    !action.enabled ||
                    pendingAction !== null ||
                    (action.id === 'assisted' &&
                      responsibilityRole === 'external_owner' &&
                      externalOwnerId.trim().length === 0)
                  }
                  data-testid={`delivery-action-${action.id}`}
                  data-action-id={action.id}
                  data-enabled={action.enabled ? 'true' : 'false'}
                  onClick={async () => {
                    if (!onAction) return;
                    setPendingAction(action.id);
                    try {
                      const next = await onAction(
                        action.id,
                        action.id === 'assisted'
                          ? {
                              ...(responsibilityRole === 'external_owner'
                                ? { ownerId: externalOwnerId.trim() }
                                : {}),
                              responsibilityRole,
                            }
                          : undefined
                      );
                      if (next) setCompletedOutcome(next);
                    } catch {
                      // Keep the panel retryable without claiming completion.
                    } finally {
                      setPendingAction(null);
                    }
                  }}
                  className="justify-start"
                >
                  {actionIcon(action.id)}
                  {action.label}
                </Button>
                {action.reason ? (
                  <p className="text-xs text-muted-foreground">
                    {action.reason}
                  </p>
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
              onClick={() =>
                onAction?.('assisted', {
                  ...(responsibilityRole === 'external_owner'
                    ? { ownerId: externalOwnerId.trim() }
                    : {}),
                  responsibilityRole,
                })
              }
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
