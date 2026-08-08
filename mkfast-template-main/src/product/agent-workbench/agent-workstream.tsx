/**
 * Agent Workstream shell: Narrative document lines + collapsible Activity,
 * Living Plan (V31-10), pending-interrupt priority strip, mobile 过程/作品
 * switch (V31-04).
 */

import { cn } from '@/lib/utils';

import {
  projectActivePlanRevisions,
  projectVisibleActivities,
  projectVisibleNarratives,
  type AgentWorkbenchClientState,
  type InterruptProjection,
} from './agent-event-reducer';
import {
  resolveMobileWorkstreamLayout,
  WORKSTREAM_MOBILE_PANE_LABELS,
  type WorkstreamMobilePane,
} from './mobile-workstream-switch';
import {
  LivingPlan,
  type CommitStripAction,
  type CommitStripView,
} from './plan';
import { ActivityLine } from './stream/activity-line';
import { NarrativeLine } from './stream/narrative-line';

export type AgentWorkstreamProps = {
  state: AgentWorkbenchClientState;
  viewport?: 'mobile' | 'desktop';
  onToggleActivity?: (activityId: string) => void;
  onMobilePaneChange?: (pane: WorkstreamMobilePane) => void;
  /** Desktop dual-column works rail / mobile works pane content. */
  worksSlot?: React.ReactNode;
  /** Optional legacy conversation / composer stream under process pane. */
  processSlot?: React.ReactNode;
  /** When true, Living Plan mounts as Compact Plan (Brief/quote/confirm unified). */
  livingPlanCompact?: boolean;
  /** Optional live commit-strip overlay (balance/quote). */
  livingPlanCommitStrip?: CommitStripView;
  onLivingPlanCommitAction?: (action: CommitStripAction) => void;
  className?: string;
};

export function AgentWorkstream({
  state,
  viewport = 'desktop',
  onToggleActivity,
  onMobilePaneChange,
  worksSlot,
  processSlot,
  livingPlanCompact = false,
  livingPlanCommitStrip,
  onLivingPlanCommitAction,
  className,
}: AgentWorkstreamProps) {
  const layout = resolveMobileWorkstreamLayout({
    viewport,
    pane: state.mobilePane,
  });
  const narratives = projectVisibleNarratives(state);
  const activities = projectVisibleActivities(state);
  const planRevisions = projectActivePlanRevisions(state);
  const interrupts = state.pendingInterrupts;

  return (
    <div
      className={cn('meiye-agent-workstream flex flex-col gap-3', className)}
      data-connection={state.connection}
      data-mobile-pane={layout.activePane}
      data-testid="agent-workstream"
      data-viewport={viewport}
    >
      {layout.showSwitch ? (
        <MobileProcessWorksSwitch
          pane={layout.activePane}
          onChange={onMobilePaneChange}
        />
      ) : null}

      {layout.showProcess ? (
        <div
          className="flex flex-col gap-3"
          data-testid="agent-workstream-process"
        >
          <PendingInterruptStrip interrupts={interrupts} />
          {narratives.map((line) => (
            <NarrativeLine
              deliveryKey={line.deliveryKey}
              id={line.id}
              key={line.id}
              occurredAt={line.occurredAt}
              streamOffset={line.streamOffset}
              text={line.text}
            />
          ))}
          {activities.map((activity) => (
            <ActivityLine
              activity={activity}
              key={activity.id}
              onToggle={onToggleActivity}
            />
          ))}
          {planRevisions.length > 0 ? (
            <LivingPlan
              commitStrip={livingPlanCommitStrip}
              compact={livingPlanCompact}
              onCommitAction={onLivingPlanCommitAction}
              revisions={planRevisions}
              viewport={viewport}
            />
          ) : null}
          {processSlot}
        </div>
      ) : null}

      {layout.showWorks && worksSlot ? (
        <div data-testid="agent-workstream-works">{worksSlot}</div>
      ) : null}
    </div>
  );
}

function PendingInterruptStrip({
  interrupts,
}: {
  interrupts: InterruptProjection[];
}) {
  if (interrupts.length === 0) return null;
  return (
    <div
      className="border-warning/40 bg-warning/10 flex flex-col gap-2 rounded-lg border px-3 py-2"
      data-testid="agent-pending-interrupts"
      role="status"
    >
      {interrupts.map((item) => (
        <div
          className="text-foreground text-sm"
          data-interrupt-id={item.interruptId}
          data-testid="agent-pending-interrupt"
          key={item.interruptId}
        >
          <p className="font-medium">需要你处理</p>
          <p className="text-muted mt-0.5 text-xs leading-relaxed">
            {item.description || item.interruptType}
          </p>
        </div>
      ))}
    </div>
  );
}

export type MobileProcessWorksSwitchProps = {
  pane: WorkstreamMobilePane;
  onChange?: (pane: WorkstreamMobilePane) => void;
};

export function MobileProcessWorksSwitch({
  pane,
  onChange,
}: MobileProcessWorksSwitchProps) {
  return (
    <div
      aria-label="过程与作品切换"
      className="bg-muted/50 flex gap-1 rounded-full p-1"
      data-testid="agent-mobile-process-works-switch"
      role="tablist"
    >
      {(['process', 'works'] as const).map((key) => {
        const selected = pane === key;
        return (
          <button
            aria-selected={selected}
            className={cn(
              'flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted hover:text-foreground'
            )}
            data-pane={key}
            data-testid={`agent-mobile-pane-${key}`}
            key={key}
            onClick={() => onChange?.(key)}
            role="tab"
            type="button"
          >
            {WORKSTREAM_MOBILE_PANE_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
