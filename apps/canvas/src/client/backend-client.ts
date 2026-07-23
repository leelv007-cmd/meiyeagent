"use client";

import type { CanvasM1Action } from "@/src/server/backend-port";

export class CanvasBackendError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "CanvasBackendError";
	}
}

export async function callCanvas<T>(
	action: CanvasM1Action,
	input: Record<string, unknown> = {},
	options: { idempotencyKey?: string; signal?: AbortSignal } = {},
) {
	const response = await fetch(`/api/canvas/${action}`, {
		body: JSON.stringify(input),
		cache: "no-store",
		credentials: "same-origin",
		headers: {
			"content-type": "application/json",
			"idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
			"x-csrf-token": readCookie("__Host-canvas-csrf") ?? "",
		},
		method: "POST",
		signal: options.signal,
	});
	const payload = (await response.json()) as {
		data?: T;
		error?: { code: string; message: string };
	};
	if (!response.ok || payload.error) {
		throw new CanvasBackendError(
			payload.error?.code ?? "REQUEST_FAILED",
			payload.error?.message ?? "Canvas request failed.",
			response.status,
		);
	}
	return payload.data as T;
}

/** The one response-streaming Canvas BFF action; callers must not bypass it. */
export function openCanvasTextStream(
	input: {
		jobId: string;
		lastEventId?: string;
		projectId: string;
	},
	options: { signal?: AbortSignal } = {},
) {
	return fetch("/api/canvas/streamTextGeneration", {
		body: JSON.stringify({
			jobId: input.jobId,
			projectId: input.projectId,
		}),
		cache: "no-store",
		credentials: "same-origin",
		headers: {
			"content-type": "application/json",
			"x-csrf-token": readCookie("__Host-canvas-csrf") ?? "",
			...(input.lastEventId ? { "last-event-id": input.lastEventId } : {}),
		},
		method: "POST",
		signal: options.signal,
	});
}

export function assetDeliveryUrl(
	assetId: string,
	options: { download?: boolean } = {},
) {
	return `/api/canvas/getAssetDelivery?assetId=${encodeURIComponent(assetId)}${options.download ? "&download=1" : ""}`;
}

function readCookie(name: string) {
	return document.cookie
		.split(";")
		.map((part) => part.trim().split("="))
		.find(([key]) => key === name)
		?.slice(1)
		.join("=");
}
