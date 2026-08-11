/**
 * Collapsible Activity line — tool/process fold in Workstream (V3.1 §28).
 * Empty activities are not rendered by the host projector.
 */

import { cn } from '@/lib/utils';

import type { AgentActivity } from '../agent-event-reducer';

export type ActivityLineProps = {
  activity: AgentActivity;
  onToggle?: (activityId: string) => void;
  className?: string;
};

export function ActivityLine({
  activity,
  onToggle,
  className,
}: ActivityLineProps) {
  const expanded = !activity.collapsed;
  const detailId = `activity-detail-${activity.id}`;

  return (
    <div
      className={cn(
        'meiye-workstream-activity border-border/40 bg-muted/30 rounded-lg border px-3 py-2 text-sm',
        className
      )}
      data-activity-status={activity.status}
      data-collapsed={activity.collapsed ? 'true' : 'false'}
      data-surface="activity"
      data-testid="agent-activity-line"
    >
      <button
        aria-controls={detailId}
        aria-expanded={expanded}
        className="text-foreground flex w-full items-center justify-between gap-2 text-left font-medium"
        data-testid="agent-activity-toggle"
        onClick={() => onToggle?.(activity.id)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate">{activity.title}</span>
        <span className="text-muted shrink-0 text-xs">
          {activity.status === 'running'
            ? '进行中'
            : activity.status === 'done'
              ? '完成'
              : activity.status === 'failed'
                ? '失败'
                : '待命'}
          {expanded ? ' · 收起' : ' · 展开'}
        </span>
      </button>
      {expanded && activity.detail ? (
        <p
          className="text-muted mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed [overflow-wrap:anywhere]"
          data-testid="agent-activity-detail"
          id={detailId}
        >
          {activity.detail}
        </p>
      ) : null}
    </div>
  );
}
