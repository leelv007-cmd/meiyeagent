import { Badge, type BadgeProps } from '@/components/reui/badge';
import { Frame, FramePanel } from '@/components/reui/frame';
import type { SupplyAuditChange } from '@/p1/admin-supply-types';

/**
 * Colour follows what the governance action did to supply: taking capacity out
 * reads as a warning, putting it back reads as a recovery. An action this
 * surface has not been taught stays outlined rather than borrowing a colour it
 * has not earned.
 */
function supplyActionVariant(action: string): BadgeProps['variant'] {
  if (/isolate|disable|suspend|pause|block/u.test(action)) {
    return 'warning-light';
  }
  if (/restore|enable|resume|activate/u.test(action)) {
    return 'success-light';
  }
  return 'outline';
}

export function SupplyAuditTable({
  changes,
}: {
  changes: SupplyAuditChange[];
}) {
  if (changes.length === 0) {
    return (
      <Frame dense spacing="sm" stacked>
        <FramePanel>
          <p className="text-sm text-muted-foreground">暂无供应治理审计记录</p>
        </FramePanel>
      </Frame>
    );
  }

  return (
    <Frame dense spacing="sm" stacked>
      {changes.map((change) => (
        <FramePanel className="space-y-2" key={change.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge size="sm" variant={supplyActionVariant(change.action)}>
                {change.action}
              </Badge>
              <span className="min-w-0 text-sm break-words">
                {change.summary}
              </span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {change.at}
            </span>
          </div>
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="inline text-muted-foreground">目标</dt>{' '}
              <dd className="inline font-mono">
                {change.targetType}/{change.targetId}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">操作者与关联</dt>{' '}
              <dd className="inline font-mono">
                {change.actorId} · {change.correlationId}
              </dd>
            </div>
          </dl>
        </FramePanel>
      ))}
    </Frame>
  );
}
