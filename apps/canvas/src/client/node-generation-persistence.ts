import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import type { CanvasGenerationBatchSnapshot } from "./node-generation-contract";
import {
	createResourceDraft,
	type ResourceDraft,
	restoreResourceDraft,
	serializeResourceDraft,
} from "./resource-workflow";

// This graph key deliberately follows the existing export-policy sensitive-key
// mapping. Saved generation snapshots remain available in the project editor,
// while export sanitization omits their internal job/model references.
export const CANVAS_NODE_GENERATION_STATE_KEY = "generationProviderSnapshot";

export type CanvasTextStreamProgress = {
	cursor?: string;
	jobId: string;
	preview: string;
	sequence: number;
	state: "disconnected" | "streaming" | "terminal";
	textNodeId: string;
};

export type CanvasNodeGenerationState = {
	batchSnapshot?: CanvasGenerationBatchSnapshot;
	resourceDraft: ResourceDraft;
	schemaVersion: 1;
	textStreams: CanvasTextStreamProgress[];
};

const MAX_STREAM_PREVIEW_LENGTH = 20_000;

/** Restores only the graph-owned, merchant-safe generation projection. */
export function restoreCanvasNodeGenerationState(
	value: unknown,
	defaultOperation: CanvasGenerationOperation,
): CanvasNodeGenerationState {
	if (!isRecord(value) || value.schemaVersion !== 1) {
		return emptyCanvasNodeGenerationState(defaultOperation);
	}
	return {
		...(isCanvasGenerationBatchSnapshot(value.batchSnapshot)
			? { batchSnapshot: clone(value.batchSnapshot) }
			: {}),
		resourceDraft:
			restoreResourceDraft(value.resourceDraft) ??
			createResourceDraft(defaultOperation),
		schemaVersion: 1,
		textStreams: Array.isArray(value.textStreams)
			? value.textStreams
					.map(restoreCanvasTextStreamProgress)
					.filter(
						(progress): progress is CanvasTextStreamProgress =>
							progress !== null,
					)
			: [],
	};
}

export function serializeCanvasNodeGenerationState(
	state: CanvasNodeGenerationState,
): CanvasNodeGenerationState {
	return {
		...(state.batchSnapshot
			? { batchSnapshot: clone(state.batchSnapshot) }
			: {}),
		resourceDraft: serializeResourceDraft(state.resourceDraft),
		schemaVersion: 1,
		textStreams: state.textStreams.map((stream) => ({
			...(stream.cursor ? { cursor: stream.cursor } : {}),
			jobId: stream.jobId,
			preview: stream.preview.slice(0, MAX_STREAM_PREVIEW_LENGTH),
			sequence: stream.sequence,
			state: stream.state,
			textNodeId: stream.textNodeId,
		})),
	};
}

export function upsertCanvasTextStreamProgress(
	state: CanvasNodeGenerationState,
	progress: CanvasTextStreamProgress,
): CanvasNodeGenerationState {
	const next = {
		...(progress.cursor ? { cursor: progress.cursor } : {}),
		jobId: progress.jobId,
		preview: progress.preview.slice(0, MAX_STREAM_PREVIEW_LENGTH),
		sequence: progress.sequence,
		state: progress.state,
		textNodeId: progress.textNodeId,
	};
	const existingIndex = state.textStreams.findIndex(
		(candidate) => candidate.jobId === progress.jobId,
	);
	if (existingIndex < 0) {
		return { ...state, textStreams: [...state.textStreams, next] };
	}
	const textStreams = [...state.textStreams];
	textStreams[existingIndex] = next;
	return { ...state, textStreams };
}

export function removeCanvasTextStreamProgress(
	state: CanvasNodeGenerationState,
	jobId: string,
): CanvasNodeGenerationState {
	return {
		...state,
		textStreams: state.textStreams.filter((stream) => stream.jobId !== jobId),
	};
}

function emptyCanvasNodeGenerationState(
	operation: CanvasGenerationOperation,
): CanvasNodeGenerationState {
	return {
		resourceDraft: createResourceDraft(operation),
		schemaVersion: 1,
		textStreams: [],
	};
}

function restoreCanvasTextStreamProgress(
	value: unknown,
): CanvasTextStreamProgress | null {
	if (!isRecord(value)) return null;
	const cursor = value.cursor;
	const jobId = value.jobId;
	const preview = value.preview;
	const sequence = value.sequence;
	const state = value.state;
	const textNodeId = value.textNodeId;
	if (
		!isIdentifier(jobId) ||
		!isIdentifier(textNodeId) ||
		typeof preview !== "string" ||
		preview.length > MAX_STREAM_PREVIEW_LENGTH ||
		typeof sequence !== "number" ||
		!Number.isSafeInteger(sequence) ||
		sequence < 0 ||
		(state !== "disconnected" &&
			state !== "streaming" &&
			state !== "terminal") ||
		(cursor !== undefined && !isIdentifier(cursor))
	) {
		return null;
	}
	return {
		...(typeof cursor === "string" ? { cursor } : {}),
		jobId,
		preview,
		sequence,
		state,
		textNodeId,
	};
}

function isCanvasGenerationBatchSnapshot(
	value: unknown,
): value is CanvasGenerationBatchSnapshot {
	if (!isRecord(value)) return false;
	return (
		value.schemaVersion === 1 &&
		isIdentifier(value.batchKey) &&
		value.confirmation === "aggregate-N-quotes-once" &&
		Array.isArray(value.items) &&
		isRecord(value.totalEstimatedProviderCost)
	);
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function isIdentifier(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
