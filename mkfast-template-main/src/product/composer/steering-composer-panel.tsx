/**
 * 中途指令 surface (V31-27 / §37.4-G).
 *
 * Sits under the running conversation: the merchant says what to change while
 * Make is still in flight, and reads back which pages that touches, which stay,
 * and whether the money question reopens.
 *
 * Every sentence about scope and cost comes from the Core classification the
 * host passes in. This component owns presentation and the one input — the
 * moment it started deciding that 「第二页」 means a patch rather than a replan,
 * the merchant would be reading the browser's opinion of her own run.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { p1ErrorCode } from '@/p1/client';
import { merchantMessageFromP1 } from '@/p1/merchant-p1-error';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  getAgentWorkbenchHostStore,
  useAgentWorkbenchState,
} from '@/product/agent-workbench/agent-event-store';

import type { ComposerSessionPhase } from './composer-session';
import type { NotePlanTimeline } from './note-plan-timeline';
import {
  listSteeringCommands,
  resolveSteeringGate,
  resolveSteeringThreadId,
  submitSteering,
} from './steering-client';
import {
  isSteeringEntryVisible,
  projectSteeringHistory,
  projectSteeringImpact,
  type SteeringCommandHistoryItem,
  type SteeringImpactView,
  type SteeringSubmitResult,
} from './steering-composer';

export type SteeringComposerPanelProps = {
  /** Host admission (`isSteeringEntryVisible`): run steerable + gate on. */
  visible: boolean;
  /** Durable commands for this task — survives reload / session restore. */
  history?: readonly SteeringCommandHistoryItem[];
  /** Host seam: `agent-session.steering_submit`. */
  onSubmit: (instruction: string) => Promise<SteeringSubmitResult>;
  /**
   * plan_change only. Puts the instruction back in the main Composer so the
   * merchant re-quotes it herself (D-164⑤: prefill, never submit).
   */
  onCarryToComposer?: (instruction: string) => void;
  className?: string;
};

const PLACEHOLDER =
  '运行中也能改：说一句要调整的地方，比如「封面别写名额，第二页少点字」';

export function SteeringComposerPanel({
  visible,
  history = [],
  onSubmit,
  onCarryToComposer,
  className,
}: SteeringComposerPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  const [impact, setImpact] = useState<SteeringImpactView | null>(null);
  const [lastInstruction, setLastInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  const handleSubmit = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onSubmit(trimmed);
      setImpact(projectSteeringImpact({ result }));
      setLastInstruction(trimmed);
      // An instruction Core refused is the one sentence worth keeping in the
      // box: the merchant is being asked to rewrite it, not to retype it.
      if (result.classification.kind !== 'unsafe_or_conflicting') {
        setInstruction('');
      }
    } catch (caught) {
      setImpact(null);
      setError(
        merchantMessageFromP1({
          code: p1ErrorCode(caught),
          message: caught instanceof Error ? caught.message : undefined,
          fallback: '这句中途调整没能送出去，请再试一次。',
        })
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label="中途调整"
      className={cn(
        'meiye-porcelain space-y-3 rounded-2xl border border-border/60 p-4',
        className
      )}
      data-testid="steering-composer"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">还想改点什么？</p>
        <p className="text-xs text-muted-foreground">
          不用等做完。说清楚要改哪一页，没点到的页会照原样继续。
        </p>
      </div>

      <textarea
        className="min-h-20 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm"
        data-testid="steering-composer-input"
        disabled={pending}
        maxLength={4000}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder={PLACEHOLDER}
        value={instruction}
      />

      <div className="flex items-center justify-end">
        <button
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          data-testid="steering-submit"
          disabled={pending || instruction.trim().length === 0}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {pending ? '正在安排…' : '这样改'}
        </button>
      </div>

      {error ? (
        <p
          className="text-sm text-destructive"
          data-testid="steering-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {impact ? (
        <SteeringImpact
          impact={impact}
          instruction={lastInstruction}
          onCarryToComposer={onCarryToComposer}
        />
      ) : null}

      {history.length > 0 ? (
        <ol className="space-y-2" data-testid="steering-command-history">
          {history.map((item) => (
            <li
              className="rounded-xl border border-border/50 px-3 py-2"
              data-command-id={item.commandId}
              data-testid="steering-command-row"
              key={item.commandId}
            >
              <p className="text-sm text-foreground">{item.instruction}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.statusLabel} · {item.impactSummary}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export type SteeringComposerHostProps = {
  phase: ComposerSessionPhase;
  taskId: string | null;
  workId: string | null;
  /** Composer run thread. Workbench/legacy-work ids do not bind the admitted run. */
  threadId?: string | null;
  /**
   * Accepted and ignored. Unit progress and the money question are Core's
   * (`steering_submit` projects both from p1_make_steering_task_progress), so
   * the browser has nothing to derive from the outline — including the
   * 确认执行 hold, which the outline paints 「配图中」 while nothing has been sent.
   * Kept on the props so composer-home does not need editing in this slice.
   */
  notePlanTimeline?: NotePlanTimeline | null;
  awaitingExecutionConfirm?: boolean;
  onCarryToComposer?: (instruction: string) => void;
  className?: string;
};

/**
 * Production wiring for the 中途指令 entry.
 *
 * Kept out of `composer-home` so the Workbench event store subscription this
 * needs (thread handle + Living Plan head) does not re-render the whole
 * Composer on every streamed frame.
 */
export function SteeringComposerHost({
  phase,
  taskId,
  workId,
  threadId,
  onCarryToComposer,
  className,
}: SteeringComposerHostProps) {
  const queryClient = useQueryClient();
  const workbench = useAgentWorkbenchState(getAgentWorkbenchHostStore());
  const attemptRef = useRef<{ instruction: string; commandId: string } | null>(
    null
  );

  const gateQuery = useQuery({
    queryKey: p1QueryKeys.request('agent-session', 'steering_gate'),
    queryFn: ({ signal }) => resolveSteeringGate(signal),
    // The kill switch is an operational lever; a browser holding a stale "on"
    // for the session would keep offering an entry that ops just closed.
    staleTime: 30_000,
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('agent-session', 'list_steering_commands', {
      taskId: taskId ?? '',
    }),
    queryFn: ({ signal }) => listSteeringCommands(taskId ?? '', signal),
    enabled: Boolean(taskId) && gateQuery.data?.enabled === true,
    retry: false,
  });

  const visible = isSteeringEntryVisible({
    phase,
    taskId,
    // A gate that has not answered yet is not an open gate: the entry appears
    // only once Core has said the path is live.
    gateEnabled: gateQuery.data?.enabled === true,
  });
  if (!visible || !taskId || !workId) return null;

  return (
    <SteeringComposerPanel
      className={className}
      history={projectSteeringHistory(historyQuery.data ?? [])}
      onCarryToComposer={onCarryToComposer}
      onSubmit={async (instruction) => {
        // One commandId per distinct sentence: a double-click replays the same
        // append-only command instead of queueing the instruction twice.
        if (attemptRef.current?.instruction !== instruction) {
          attemptRef.current = {
            instruction,
            commandId: `steer-${crypto.randomUUID()}`,
          };
        }
        const boundThreadId =
          threadId?.trim() ||
          (await resolveSteeringThreadId({
            workbenchThreadId: workbench.session?.threadId ?? null,
            workId,
          }));
        const result = await submitSteering({
          commandId: attemptRef.current.commandId,
          instruction,
          taskId,
          threadId: boundThreadId,
        });
        attemptRef.current = null;
        await queryClient.invalidateQueries({
          queryKey: p1QueryKeys.request(
            'agent-session',
            'list_steering_commands',
            { taskId }
          ),
        });
        return result;
      }}
      visible
    />
  );
}

function SteeringImpact({
  impact,
  instruction,
  onCarryToComposer,
}: {
  impact: SteeringImpactView;
  instruction: string;
  onCarryToComposer?: (instruction: string) => void;
}) {
  return (
    <output
      className="block space-y-2 rounded-xl border border-border/60 bg-content1/60 px-3 py-2.5"
      data-kind={impact.kind}
      data-testid="steering-impact"
    >
      <p className="text-sm text-foreground">{impact.summary}</p>

      {impact.affectedLabels.length > 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="steering-impact-affected"
        >
          会改：{impact.affectedLabels.join('、')}
        </p>
      ) : null}
      {impact.preservedLabels.length > 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="steering-impact-preserved"
        >
          保持不变：{impact.preservedLabels.join('、')}
        </p>
      ) : null}
      {impact.feeNote ? (
        <p
          className="text-xs text-muted-foreground"
          data-rebilled={impact.rebilled ? 'true' : 'false'}
          data-testid="steering-impact-fee"
        >
          {impact.feeNote}
        </p>
      ) : null}
      {impact.settledNote ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="steering-impact-settled"
        >
          {impact.settledNote}
        </p>
      ) : null}
      {impact.queueNote ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="steering-impact-queue"
        >
          {impact.queueNote}
        </p>
      ) : null}

      {impact.requiresRequote ? (
        <div
          className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2"
          data-testid="plan-requote-card"
        >
          <p className="text-sm font-medium text-foreground">
            这句要重新报一次方案
          </p>
          <p className="text-xs text-muted-foreground">
            当前这次创作会按原来的方案做完，不会中途变数量或平台，也不会因为这句话
            多扣积分。改动要生效，得回到方案层重新算一次积分并确认。
          </p>
          {onCarryToComposer ? (
            <button
              className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm font-medium"
              data-testid="plan-requote-carry"
              onClick={() => onCarryToComposer(instruction)}
              type="button"
            >
              把这句放回创作框
            </button>
          ) : null}
        </div>
      ) : null}

      {impact.requiresCorrection ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="steering-correction-hint"
        >
          换个说法再试：指明要改的是封面还是第几页，会更容易落到位。
        </p>
      ) : null}
    </output>
  );
}
