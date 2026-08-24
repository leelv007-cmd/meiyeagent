/**
 * V31-82: bounded timeout for Composer works that stay running with no
 * generation progress. Reuses the reservation-sweeper shape (claim →
 * refund+terminal → mark) so a missing worker / silent workflow cannot
 * lock merchant credits or the Composer forever.
 */

export const DEFAULT_STALLED_WORK_TIMEOUT_MS = 15 * 60 * 1_000;
export const STALLED_WORK_TIMEOUT_ENV = "STALLED_WORK_TIMEOUT_MS";
export const STALLED_WORK_FAILURE_CODE = "WORK_EXECUTION_STALLED";
export const STALLED_WORK_REFUND_OPERATION_PREFIX = "stalled-work-refund:";

export type StalledWorkWindow = "work_running_no_job" | "job_stale_no_progress";

/**
 * `orchestration_lost` (V31-105 §13 ①A): the run's DBOS workflow is registered
 * nowhere, so its media result can never be delivered back. Same terminal
 * shape as a timeout — the work fails, the reservation returns, and the
 * merchant gets the existing report card and restart entry — but the merchant
 * must not be told it timed out, because it did not.
 *
 * `prepare_rejected` (V31-108): prepare terminal-rejected the reserved
 * creation before Harness start. Same terminal shape; the merchant sentence
 * must not say 超时, because the run never began.
 */
export type StalledWorkTerminalReason =
	| "timeout"
	| "cancelled"
	| "orchestration_lost"
	| "prepare_rejected";

export interface StalledWorkSweep {
	workspaceId: string;
	submissionId: string;
	workId: string;
	taskId: string;
	window: StalledWorkWindow;
}

export interface StalledWorkSweepStore {
	claimBatch(input: {
		expiresBefore: string;
		limit: number;
	}): Promise<StalledWorkSweep[]>;
	terminate(input: {
		sweep: StalledWorkSweep;
		reason: StalledWorkTerminalReason;
		now: string;
	}): Promise<"terminated" | "already_terminal" | "missing">;
}

export function resolveStalledWorkTimeoutMs(
	env: NodeJS.ProcessEnv = process.env,
): number {
	const raw = env[STALLED_WORK_TIMEOUT_ENV];
	if (raw === undefined || raw === "") return DEFAULT_STALLED_WORK_TIMEOUT_MS;
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(
			"Stalled work timeout must be a positive integer millisecond value.",
		);
	}
	return parsed;
}

export function stalledWorkRefundOperationId(taskId: string): string {
	return `${STALLED_WORK_REFUND_OPERATION_PREFIX}${taskId}`;
}

/**
 * Merchant sentence for a prepare-terminal rejection. The rejection detail is
 * appended only when it is already human language (CJK) and does not look
 * like a stack / internal identifier. English Error messages stay off the
 * report card.
 */
export function prepareRejectedMerchantMessage(detail?: string): string {
	const safe = merchantSafePrepareRejectionDetail(detail);
	if (!safe) return "这次创作没能开始，积分已经退回。";
	return `这次创作没能开始，${safe}。积分已经退回。`;
}

export function merchantSafePrepareRejectionDetail(
	detail?: string,
): string | undefined {
	if (typeof detail !== "string") return undefined;
	const text = detail.replace(/\s+/gu, " ").trim();
	if (!text || text.length > 80) return undefined;
	if (!/[\u4e00-\u9fff]/u.test(text)) return undefined;
	if (
		/(?:Error|TypeError|at\s+\S+\s+\(|\bstack\b|\bworkflow\b|\bsnapshot\b|\bschema\b|\bHTTP\b|\bprovider\b)/iu.test(
			text,
		)
	) {
		return undefined;
	}
	return text.replace(/[。．.]+$/u, "");
}

export class StalledWorkSweeper {
	constructor(
		private readonly store: StalledWorkSweepStore,
		private readonly options: {
			batchSize?: number;
			now?: () => Date;
			timeoutMs?: number | (() => number | Promise<number>);
		} = {},
	) {}

	async runOnce() {
		const now = this.options.now?.() ?? new Date();
		const timeoutMs = await resolveTimeoutMs(this.options.timeoutMs);
		const expiresBefore = new Date(now.getTime() - timeoutMs).toISOString();
		const sweeps = await this.store.claimBatch({
			expiresBefore,
			limit: this.options.batchSize ?? 20,
		});
		let terminated = 0;
		let alreadyTerminal = 0;
		let failed = 0;
		for (const sweep of sweeps) {
			try {
				const outcome = await this.store.terminate({
					sweep,
					reason: "timeout",
					now: now.toISOString(),
				});
				if (outcome === "terminated") terminated += 1;
				else if (outcome === "already_terminal") alreadyTerminal += 1;
			} catch {
				failed += 1;
			}
		}
		return {
			claimed: sweeps.length,
			terminated,
			alreadyTerminal,
			failed,
		};
	}
}

async function resolveTimeoutMs(
	configured: number | (() => number | Promise<number>) | undefined,
): Promise<number> {
	const value =
		typeof configured === "function" ? await configured() : configured;
	const timeoutMs = value ?? resolveStalledWorkTimeoutMs();
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
		throw new Error(
			"Stalled work timeout must be a positive integer millisecond value.",
		);
	}
	return timeoutMs;
}
