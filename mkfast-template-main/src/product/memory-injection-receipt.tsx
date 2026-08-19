/**
 * V31-18: injection receipt visibility panel (任务详情 — workbench task surface).
 *
 * When a task has a bound MemoryInjectionReceipt, the merchant sees exactly
 * which memories were injected into the run (source memory, content, time) and
 * can revoke any of them from future injection. The receipt itself is a trace
 * and stays visible after revocation (V3.1 §12.7 / §37.4-B2).
 *
 * V31-34 / FIX-P1-02: revoke button state is derived from the server-side
 * `currentStatus` projection on each receipt entry (preference head authority),
 * not from local mutation state. Refresh keeps the revoked UI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemoryInjectionReceipt } from '@meiye/contracts';

import { formatLocaleDate } from '@/lib/locale';
import {
  memory_injection_receipt_injected_at,
  memory_injection_receipt_revoke,
  memory_injection_receipt_revoked,
  memory_injection_receipt_title,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { formatMemorySource } from '@/product/memory-source-format';

/** Fail closed: only a live confirmed head stays revocable. */
function isRevokedAuthority(
  currentStatus: MemoryInjectionReceipt['entries'][number]['currentStatus']
): boolean {
  return currentStatus !== 'confirmed';
}

export function MemoryInjectionReceiptPanel({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();

  const receiptQuery = useQuery({
    queryKey: p1QueryKeys.request('memory', 'injection_receipt', { taskId }),
    queryFn: ({ signal }) =>
      queryP1<{ receipt: MemoryInjectionReceipt | null }>(
        'memory',
        { action: 'injection_receipt', payload: { taskId } },
        signal
      ),
  });

  const revoke = useMutation({
    mutationFn: (input: { memoryId: string; expectedRevision: number }) =>
      commandP1(
        'memory',
        {
          action: 'revoke_memory',
          payload: {
            memoryId: input.memoryId,
            expectedRevision: input.expectedRevision,
          },
        },
        `memory:revoke:${input.memoryId}`
      ),
    onSuccess: async () => {
      // Authority comes from the server projection — refetch, do not seed a Set.
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('memory'),
      });
    },
  });

  const receipt = receiptQuery.data?.receipt;
  if (!receipt || receipt.entries.length === 0) return null;

  return (
    <section
      className="meiye-porcelain rounded-2xl p-5 sm:p-6"
      data-testid="memory-injection-receipt-panel"
      data-task-id={taskId}
    >
      <h2 className="text-base font-semibold leading-7">
        {memory_injection_receipt_title()}
      </h2>
      <p className="meiye-type-aux mt-1">
        {memory_injection_receipt_injected_at({
          date: formatLocaleDate(receipt.injectedAt),
        })}
      </p>
      <ul className="mt-3 space-y-3">
        {receipt.entries.map((entry) => {
          const revoked = isRevokedAuthority(entry.currentStatus);
          const revokePendingForEntry =
            revoke.isPending && revoke.variables?.memoryId === entry.memoryId;
          return (
            <li
              className="rounded-xl border border-foreground/10 p-3 text-sm"
              data-memory-id={entry.memoryId}
              data-testid={`memory-injection-receipt-entry-${entry.memoryId}`}
              key={entry.memoryId}
            >
              <p data-testid="memory-injection-receipt-statement">
                {entry.statement}
              </p>
              <p
                className="meiye-type-aux mt-1"
                data-testid="memory-injection-receipt-source"
              >
                {formatMemorySource(entry.source)}
              </p>
              <button
                className="mt-2"
                data-testid={`memory-injection-receipt-revoke-${entry.memoryId}`}
                disabled={revoked || revokePendingForEntry}
                onClick={() =>
                  revoke.mutate({
                    memoryId: entry.memoryId,
                    expectedRevision: entry.revision,
                  })
                }
                type="button"
              >
                {revoked
                  ? memory_injection_receipt_revoked()
                  : memory_injection_receipt_revoke()}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
