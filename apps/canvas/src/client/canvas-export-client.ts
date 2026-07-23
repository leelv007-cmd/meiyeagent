"use client";

import { CanvasBackendError } from "./backend-client";

export type CanvasExportInput = {
	includeAvailableOnly?: boolean;
	projectId: string;
	revisionId: string;
};

/**
 * An idempotency key belongs to one deliberate export submission. Callers
 * retain this request when retrying a failed ZIP download.
 */
export type CanvasExportRequest = CanvasExportInput & {
	idempotencyKey: string;
};

export type CanvasExportDownload = {
	fileName: string;
	manifestSha256: string | null;
	zipSha256: string | null;
};

type CanvasExportResponse = CanvasExportDownload & {
	blob: Blob;
};

type CanvasExportPorts = {
	fetcher?: typeof fetch;
	triggerDownload?(blob: Blob, fileName: string): void;
};

/**
 * The ZIP endpoint is deliberately separate from the JSON Canvas client.  It
 * keeps the server's pro-studio-canvas-export/v1 artifact opaque to the UI.
 */
export function buildCanvasExportRequest(input: CanvasExportInput) {
	return {
		format: "zip" as const,
		...(input.includeAvailableOnly
			? { includeAvailableOnly: true as const }
			: {}),
		projectId: input.projectId,
		revisionId: input.revisionId,
	};
}

/**
 * Keep a failed submission's key for the same frozen revision. Selecting a
 * different revision or availability policy starts a new export intent.
 */
export function resolveCanvasExportIntent(
	previous: CanvasExportRequest | null,
	input: CanvasExportInput,
	createIdempotencyKey: () => string = () => crypto.randomUUID(),
): CanvasExportRequest {
	if (
		previous &&
		previous.projectId === input.projectId &&
		previous.revisionId === input.revisionId &&
		Boolean(previous.includeAvailableOnly) ===
			Boolean(input.includeAvailableOnly)
	) {
		return previous;
	}
	return {
		...(input.includeAvailableOnly ? { includeAvailableOnly: true } : {}),
		idempotencyKey: createIdempotencyKey(),
		projectId: input.projectId,
		revisionId: input.revisionId,
	};
}

export function parseCanvasExportHeaders(
	headers: Headers,
): CanvasExportDownload {
	return {
		// The export service's attachment name is intentionally opaque here: it can
		// contain persistence identifiers, while the browser needs only a safe ZIP
		// name for the local download.
		fileName: "canvas-export.zip",
		manifestSha256: headers.get("x-canvas-export-manifest-sha256"),
		zipSha256: headers.get("x-canvas-export-zip-sha256"),
	};
}

export async function requestCanvasExport(
	input: CanvasExportRequest,
	ports: Pick<CanvasExportPorts, "fetcher"> = {},
): Promise<CanvasExportResponse> {
	const fetcher = ports.fetcher ?? fetch;
	const response = await fetcher("/api/canvas/exportCanvas", {
		body: JSON.stringify(buildCanvasExportRequest(input)),
		cache: "no-store",
		credentials: "same-origin",
		headers: {
			"content-type": "application/json",
			"idempotency-key": input.idempotencyKey,
			"x-csrf-token": readCookie("__Host-canvas-csrf") ?? "",
		},
		method: "POST",
	});
	if (!response.ok) throw await exportError(response);
	const metadata = parseCanvasExportHeaders(response.headers);
	return { ...metadata, blob: await response.blob() };
}

export async function downloadCanvasExport(
	input: CanvasExportRequest,
	ports: CanvasExportPorts = {},
): Promise<CanvasExportDownload> {
	const exported = await requestCanvasExport(input, ports);
	(ports.triggerDownload ?? triggerCanvasExportDownload)(
		exported.blob,
		exported.fileName,
	);
	return {
		fileName: exported.fileName,
		manifestSha256: exported.manifestSha256,
		zipSha256: exported.zipSha256,
	};
}

export function triggerCanvasExportDownload(blob: Blob, fileName: string) {
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = objectUrl;
	anchor.download = fileName;
	anchor.style.display = "none";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function exportError(response: Response) {
	try {
		const payload = (await response.json()) as {
			error?: { code?: string; message?: string };
		};
		return new CanvasBackendError(
			payload.error?.code ?? "EXPORT_FAILED",
			payload.error?.message ?? "画布导出失败，请重试。",
			response.status,
		);
	} catch {
		return new CanvasBackendError(
			"EXPORT_FAILED",
			"画布导出失败，请重试。",
			response.status,
		);
	}
}

function readCookie(name: string) {
	if (typeof document === "undefined") return undefined;
	return document.cookie
		.split(";")
		.map((part) => part.trim().split("="))
		.find(([key]) => key === name)
		?.slice(1)
		.join("=");
}
