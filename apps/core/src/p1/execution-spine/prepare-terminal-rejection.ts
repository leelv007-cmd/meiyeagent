/**
 * V31-108 — what the merchant sees when prepare terminal-rejects a reserved
 * creation. The reservation refund already existed (V31-41); the running work
 * did not, so Composer stayed on 创作进行中 with no report card and no
 * 改一下要求, and the stalled-work sweeper would not pick the row up because
 * harness_state was already `failed`.
 *
 * Same terminal shape as V31-105 §13 ①A / V31-82: `terminateRunningWork`
 * fails the work, refunds reserved usage and credits once, and writes
 * `workflow_failed` under the task id and prepared-attempt run id. Only the
 * reason and merchant sentence differ — this creation never started, and the
 * merchant must not be told it timed out.
 *
 * Reverse wiring: if this helper passed `reason: 'timeout'`, the V31-108
 * postgres test fails on `failureReason` and on the 超时-forbidden merchant
 * sentence (same flip as V31-105 §13 ①A).
 *
 * Fail closed: a store without `terminateRunningWork` must throw rather than
 * leave the work running. Idempotent by construction — `already_terminal`
 * once the work is no longer `running`.
 */
export async function failCreationForPrepareTerminalRejection(
	store: {
		terminateRunningWork?(input: {
			workspaceId: string;
			taskId?: string;
			workId?: string;
			reason: "timeout" | "cancelled" | "orchestration_lost" | "prepare_rejected";
			detail?: string;
			now?: string;
		}): Promise<"terminated" | "already_terminal" | "missing">;
	},
	input: {
		workspaceId: string;
		taskId?: string;
		workId?: string;
		/** Merchant-safe prepare rejection text; omitted when not safe. */
		detail?: string;
		now?: string;
	},
): Promise<"terminated" | "already_terminal" | "missing"> {
	const terminate = store.terminateRunningWork;
	if (!terminate) {
		throw new Error(
			"Prepare terminal rejection cannot fail closed: CreationSubmissionStore.terminateRunningWork is missing.",
		);
	}
	return terminate.call(store, {
		workspaceId: input.workspaceId,
		reason: "prepare_rejected",
		...(input.taskId ? { taskId: input.taskId } : {}),
		...(input.workId ? { workId: input.workId } : {}),
		...(input.detail ? { detail: input.detail } : {}),
		...(input.now ? { now: input.now } : {}),
	});
}
