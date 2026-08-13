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

export type StalledWorkTerminalReason = "timeout" | "cancelled";

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
