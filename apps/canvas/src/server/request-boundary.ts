const MAX_JSON_BYTES = 1024 * 1024;
const MAX_FORM_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 50_000;

export class CanvasRouteBoundaryError extends Error {
	constructor(
		readonly status: 400 | 413 | 415,
		readonly code:
			| "INVALID_CONTENT_TYPE"
			| "INVALID_JSON"
			| "JSON_TOO_COMPLEX"
			| "REQUEST_BODY_TOO_LARGE",
		message: string,
	) {
		super(message);
		this.name = "CanvasRouteBoundaryError";
	}
}

export async function readBoundedJson(request: Request) {
	const contentType = request.headers.get("content-type")?.split(";", 1)[0];
	if (contentType !== "application/json") {
		throw new CanvasRouteBoundaryError(
			415,
			"INVALID_CONTENT_TYPE",
			"Content-Type must be application/json.",
		);
	}
	const bytes = await readBytesUpTo(request, MAX_JSON_BYTES);
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		throw new CanvasRouteBoundaryError(
			400,
			"INVALID_JSON",
			"Request body must be valid JSON.",
		);
	}
	assertJsonComplexity(value);
	return value;
}

export async function readBoundedFormData(request: Request) {
	const contentType = request.headers.get("content-type");
	if (
		!contentType ||
		(!contentType.startsWith("application/x-www-form-urlencoded") &&
			!contentType.startsWith("multipart/form-data;"))
	) {
		throw new CanvasRouteBoundaryError(
			415,
			"INVALID_CONTENT_TYPE",
			"A form Content-Type header is required.",
		);
	}
	const bytes = await readBytesUpTo(request, MAX_FORM_BYTES);
	return new Request(request.url, {
		body: bytes,
		headers: { "content-type": contentType },
		method: "POST",
	}).formData();
}

export function canvasRouteBoundaryResponse(error: unknown) {
	if (!(error instanceof CanvasRouteBoundaryError)) throw error;
	return Response.json(
		{ error: { code: error.code, message: error.message } },
		{ status: error.status, headers: { "cache-control": "no-store" } },
	);
}

async function readBytesUpTo(request: Request, maxBytes: number) {
	const declaredLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw bodyTooLarge();
	}
	if (!request.body) return new Uint8Array();

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytesRead = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytesRead += value.byteLength;
		if (bytesRead > maxBytes) {
			await reader.cancel();
			throw bodyTooLarge();
		}
		chunks.push(value);
	}
	const result = new Uint8Array(bytesRead);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function assertJsonComplexity(value: unknown) {
	const pending: Array<{ depth: number; value: unknown }> = [
		{ depth: 0, value },
	];
	let nodes = 0;
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) break;
		nodes += 1;
		if (current.depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES) {
			throw new CanvasRouteBoundaryError(
				400,
				"JSON_TOO_COMPLEX",
				"Request JSON exceeds the complexity limit.",
			);
		}
		if (!current.value || typeof current.value !== "object") continue;
		const children = Array.isArray(current.value)
			? current.value
			: Object.values(current.value);
		for (const child of children) {
			pending.push({ depth: current.depth + 1, value: child });
		}
	}
}

function bodyTooLarge() {
	return new CanvasRouteBoundaryError(
		413,
		"REQUEST_BODY_TOO_LARGE",
		"Request body exceeds the route limit.",
	);
}
