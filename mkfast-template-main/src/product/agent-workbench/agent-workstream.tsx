/**
 * Agent Workstream shell: Narrative document lines + collapsible Activity,
 * Living Plan (V31-10), pending-interrupt priority strip, mobile 过程/作品
 * switch (V31-04), right-rail Artifact canvas (V31-15 production wiring).
 */

import { cn } from '@/lib/utils';
import type { OutcomeSelfReportChipSignal } from '@meiye/contracts';

import { ThisRunExperienceEntry } from '@/product/this-run-experience';

import {
  boundWorkbenchTaskId,
  projectActivePlanRevisions,
  projectVisibleActivities,
  projectVisibleArtifacts,
  projectVisibleNarratives,
  type AgentWorkbenchClientState,
  type InterruptProjection,
} from './agent-event-reducer';
import { ArtifactCanvas } from './artifact/artifact-canvas';
import { ArtifactMobileSheet } from './artifact/artifact-mobile-sheet';
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
import {
  PublishHandoffPanel,
  type PublishHandoffPanelView,
} from './publish-handoff';
import { ActivityLine } from './stream/activity-line';
import { NarrativeLine } from './stream/narrative-line';
import { isAgentWorkstreamDelivered } from './workstream-delivered';

export type AgentWorkstreamProps = {
  state: AgentWorkbenchClientState;
  viewport?: 'mobile' | 'desktop';
  onToggleActivity?: (activityId: string) => void;
  onMobilePaneChange?: (pane: WorkstreamMobilePane) => void;
  /** Version 回看: null returns to live head. */
  onArtifactViewRevision?: (
    artifactId: string,
    revision: number | null
  ) => void;
  /** Desktop dual-column works rail / mobile works pane content (extra). */
  worksSlot?: React.ReactNode;
  /** Optional legacy conversation / composer stream under process pane. */
  processSlot?: React.ReactNode;
  /** Merchant turns already shown in processSlot — do not repeat as 叙述. */
  excludeNarrativeTexts?: readonly string[];
  /** When true, Living Plan mounts as Compact Plan (Brief/quote/confirm unified). */
  livingPlanCompact?: boolean;
  /** Optional live commit-strip overlay (balance/quote). */
  livingPlanCommitStrip?: CommitStripView;
  onLivingPlanCommitAction?: (action: CommitStripAction) => void;
  confirmationRequestId?: string | null;
  requiresMerchantConfirmation?: boolean;
  /**
   * Composer session reached delivered (delivery card / harness success).
   * Handoff materials are later and must not gate this flag.
   */
  sessionDelivered?: boolean;
  /**
   * Composer session reached failed. A 申报卡 in processSlot is the merchant
   * terminal; Living Plan 开始制作 must not cover it (W03 失败档).
   */
  sessionFailed?: boolean;
  /**
   * V31-17 Delivered publish handoff materials (production path after delivery).
   * When set, panel renders under Artifact canvas in works pane.
   */
  publishHandoffError?: string | null;
  publishHandoffView?: PublishHandoffPanelView | null;
  selfReportPrompt?: string | null;
  selfReportChips?: readonly OutcomeSelfReportChipSignal[];
  onPublishHandoffCopy?: (
    role: string,
    value: string
  ) => boolean | Promise<boolean>;
  onPublishHandoffDownloadZip?: (fileName: string) => void | Promise<void>;
  onPublishHandoffRecordPublished?: (input: {
    contentPackageId: string;
    contentPackageRevision: number;
    platformUrl?: string;
    note?: string;
  }) => void | Promise<void>;
  onSelfReportChip?: (
    signal: OutcomeSelfReportChipSignal
  ) => void | Promise<void>;
  onSelfReportIgnore?: () => void | Promise<void>;
  className?: string;
  interruptError?: string | null;
  resumingInterruptId?: string | null;
  onInterruptResume?: (
    interrupt: InterruptProjection,
    type: 'accept' | 'reject'
  ) => void | Promise<void>;
};

export function AgentWorkstream({
  state,
  viewport = 'desktop',
  onToggleActivity,
  onMobilePaneChange,
  onArtifactViewRevision,
  worksSlot,
  processSlot,
  excludeNarrativeTexts,
  livingPlanCompact = false,
  livingPlanCommitStrip,
  onLivingPlanCommitAction,
  confirmationRequestId = null,
  requiresMerchantConfirmation = false,
  sessionDelivered = false,
  sessionFailed = false,
  publishHandoffError = null,
  publishHandoffView,
  selfReportPrompt,
  selfReportChips,
  onPublishHandoffCopy,
  onPublishHandoffDownloadZip,
  onPublishHandoffRecordPublished,
  onSelfReportChip,
  onSelfReportIgnore,
  className,
  interruptError = null,
  resumingInterruptId = null,
  onInterruptResume,
}: AgentWorkstreamProps) {
  const layout = resolveMobileWorkstreamLayout({
    viewport,
    pane: state.mobilePane,
  });
  const excludedNarratives = new Set(
    (excludeNarrativeTexts ?? [])
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
  );
  const narratives = projectVisibleNarratives(state).filter(
    (line) => !excludedNarratives.has(line.text.trim())
  );
  const activities = projectVisibleActivities(state);
  const artifacts = projectVisibleArtifacts(state);
  const delivered = isAgentWorkstreamDelivered({
    deliveredKeyCount: state.deliveredKeys.size,
    publishHandoffError,
    publishHandoffView,
    sessionDelivered,
  });
  const planRevisions = projectActivePlanRevisions(state).map((revision) =>
    delivered && revision.planLifecycle !== 'failed'
      ? { ...revision, planLifecycle: 'delivered' as const }
      : revision
  );
  const interrupts = state.pendingInterrupts;
  const mobileWorksOpen = viewport === 'mobile' && layout.showWorks;
  const receiptTaskId = boundWorkbenchTaskId(state);
  const expectArtifactContent =
    artifacts.length > 0 ||
    delivered ||
    narratives.length > 0 ||
    activities.length > 0 ||
    Boolean(receiptTaskId) ||
    Boolean(state.session?.threadId);
  const experienceEntry =
    state.session || receiptTaskId ? (
      <ThisRunExperienceEntry taskId={receiptTaskId} />
    ) : null;

  const publishHandoffNode = publishHandoffView ? (
    <PublishHandoffPanel
      onCopyBlock={onPublishHandoffCopy}
      onDownloadZip={onPublishHandoffDownloadZip}
      onIgnoreSelfReport={onSelfReportIgnore}
      onRecordPublished={onPublishHandoffRecordPublished}
      onSelfReport={onSelfReportChip}
      selfReportChips={selfReportChips}
      selfReportPrompt={selfReportPrompt}
      view={publishHandoffView}
    />
  ) : publishHandoffError ? (
    <p
      className="border-danger/30 bg-danger/5 text-danger rounded-xl border px-4 py-3 text-sm"
      data-testid="publish-handoff-error"
      role="alert"
    >
      {publishHandoffError}
    </p>
  ) : null;

  return (
    <div
      className={cn('meiye-agent-workstream flex flex-col gap-3', className)}
      data-connection={state.connection}
      data-delivered={delivered ? 'true' : 'false'}
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
          <PendingInterruptStrip
            error={interruptError}
            interrupts={interrupts}
            onResume={onInterruptResume}
            resumingInterruptId={resumingInterruptId}
          />
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
          {planRevisions.length > 0 && !sessionFailed ? (
            <LivingPlan
              commitStrip={livingPlanCommitStrip}
              compact={livingPlanCompact}
              confirmationRequestId={confirmationRequestId}
              onCommitAction={onLivingPlanCommitAction}
              requiresMerchantConfirmation={requiresMerchantConfirmation}
              revisions={planRevisions}
              viewport={viewport}
            />
          ) : null}
          {processSlot}
        </div>
      ) : null}

      {layout.showWorks && viewport === 'desktop' ? (
        <div
          className="flex flex-col gap-3"
          data-testid="agent-workstream-works"
        >
          <ArtifactCanvas
            artifacts={artifacts}
            onViewRevision={onArtifactViewRevision}
            showEmpty={expectArtifactContent}
            viewport="desktop"
          />
          {experienceEntry}
          {publishHandoffNode}
          {worksSlot}
        </div>
      ) : null}

      {mobileWorksOpen ? (
        <ArtifactMobileSheet
          artifacts={artifacts}
          onClose={() => onMobilePaneChange?.('process')}
          onViewRevision={onArtifactViewRevision}
          open
          showEmpty={expectArtifactContent}
        >
          {experienceEntry}
          {publishHandoffNode}
          {worksSlot}
        </ArtifactMobileSheet>
      ) : null}
    </div>
  );
}

function PendingInterruptStrip({
  error,
  interrupts,
  onResume,
  resumingInterruptId,
}: {
  error: string | null;
  interrupts: InterruptProjection[];
  onResume?: (
    interrupt: InterruptProjection,
    type: 'accept' | 'reject'
  ) => void | Promise<void>;
  resumingInterruptId: string | null;
}) {
  if (interrupts.length === 0 && !error) return null;
  return (
    <output
      className="border-warning/40 bg-warning/10 flex flex-col gap-2 rounded-lg border px-3 py-2"
      data-testid="agent-pending-interrupts"
    >
      {interrupts.map((item) => (
        <div
          className="text-foreground text-sm"
          data-interrupt-id={item.interruptId}
          data-interrupt-revision={item.revision}
          data-interrupt-schema-version={item.schemaVersion ?? ''}
          data-testid="agent-pending-interrupt"
          key={item.interruptId}
        >
          <p className="font-medium">需要你处理</p>
          <p className="text-muted mt-0.5 text-xs leading-relaxed">
            {item.description || item.interruptType}
          </p>
          {onResume ? (
            <div className="mt-2 flex gap-2">
              {item.allowAccept !== false ? (
                <button
                  className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  data-testid="agent-interrupt-accept"
                  disabled={resumingInterruptId === item.interruptId}
                  onClick={() => void onResume(item, 'accept')}
                  type="button"
                >
                  确认并继续
                </button>
              ) : null}
              {item.allowReject ? (
                <button
                  className="border-border rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  data-testid="agent-interrupt-reject"
                  disabled={resumingInterruptId === item.interruptId}
                  onClick={() => void onResume(item, 'reject')}
                  type="button"
                >
                  停止本次任务
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {error ? (
        <p
          className="text-destructive text-xs"
          data-testid="agent-interrupt-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </output>
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
