/**
 * ARCH-07A workbench/host/artifact controller.
 *
 * Public seam: AgentWorkbenchHost bindings. Production Composer always
 * subscribes live semantic SSE — the host does not invent subscribeLive.
 */

import {
  AgentWorkbenchHost,
  type AgentWorkbenchHostProps,
} from '@/product/agent-workbench/agent-workbench';
import {
  loadAgentWorkbenchReplay,
  subscribeAgentSemanticEvents,
} from '@/product/agent-workbench/agent-event-transport';
import type { UsePublishHandoffResult } from '@/product/agent-workbench/publish-handoff/use-publish-handoff';

export type ComposerWorkbenchPublishHandoff = Pick<
  UsePublishHandoffResult,
  | 'onPublishHandoffCopy'
  | 'onPublishHandoffDownloadZip'
  | 'onPublishHandoffRecordPublished'
  | 'onSelfReportChip'
  | 'onSelfReportIgnore'
  | 'publishHandoffError'
  | 'publishHandoffView'
  | 'selfReportChips'
  | 'selfReportPrompt'
>;

export type ComposerWorkbenchControllerInput = {
  accountId?: string | null;
  confirmationRequestId?: string | null;
  excludeNarrativeTexts?: readonly string[];
  explicitTaskId?: string | null;
  explicitThreadId?: string | null;
  onLivingPlanCommitAction?: AgentWorkbenchHostProps['onLivingPlanCommitAction'];
  processSlot?: React.ReactNode;
  publishHandoff: ComposerWorkbenchPublishHandoff;
  requiresMerchantConfirmation?: boolean;
  sessionDelivered?: boolean;
  viewport?: AgentWorkbenchHostProps['viewport'];
  worksSlot?: React.ReactNode;
  workspaceId?: string | null;
};

export type ComposerWorkbenchHostBindings = Omit<
  AgentWorkbenchHostProps,
  'processSlot' | 'worksSlot'
> & {
  loadReplay: typeof loadAgentWorkbenchReplay;
  subscribeLive: typeof subscribeAgentSemanticEvents;
};

/**
 * Owned Workbench host bindings. Callers cannot omit SSE: subscribeLive is
 * always the authenticated semantic subscriber, never a poll-only undefined.
 */
export function composerWorkbenchHostBindings(
  input: ComposerWorkbenchControllerInput
): ComposerWorkbenchHostBindings {
  return {
    accountId: input.accountId ?? null,
    confirmationRequestId: input.confirmationRequestId ?? null,
    enableIdleGoalProactive: false,
    excludeNarrativeTexts: input.excludeNarrativeTexts,
    explicitTaskId: input.explicitTaskId ?? null,
    explicitThreadId: input.explicitThreadId ?? null,
    loadReplay: loadAgentWorkbenchReplay,
    onLivingPlanCommitAction: input.onLivingPlanCommitAction,
    requiresMerchantConfirmation: input.requiresMerchantConfirmation === true,
    sessionDelivered: input.sessionDelivered === true,
    onPublishHandoffCopy: input.publishHandoff.onPublishHandoffCopy,
    onPublishHandoffDownloadZip:
      input.publishHandoff.onPublishHandoffDownloadZip,
    onPublishHandoffRecordPublished:
      input.publishHandoff.onPublishHandoffRecordPublished,
    onSelfReportChip: input.publishHandoff.onSelfReportChip,
    onSelfReportIgnore: input.publishHandoff.onSelfReportIgnore,
    publishHandoffError: input.publishHandoff.publishHandoffError,
    publishHandoffView: input.publishHandoff.publishHandoffView,
    selfReportChips: input.publishHandoff.selfReportChips,
    selfReportPrompt: input.publishHandoff.selfReportPrompt,
    subscribeLive: subscribeAgentSemanticEvents,
    viewport: input.viewport,
    workspaceId: input.workspaceId ?? null,
  };
}

export function useComposerWorkbenchController(
  input: ComposerWorkbenchControllerInput
) {
  return { host: composerWorkbenchHostBindings(input) };
}

export function ComposerWorkbenchHost(props: ComposerWorkbenchControllerInput) {
  const { host } = useComposerWorkbenchController(props);
  return (
    <AgentWorkbenchHost
      {...host}
      processSlot={props.processSlot}
      worksSlot={props.worksSlot}
    />
  );
}
