"use client";

import { CanvasBackendError, openCanvasTextStream } from "./backend-client";

export type CanvasTextStreamEvent =
	| {
			cursor?: string;
			jobId: string;
			sequence: number;
			type: "delta";
			delta: string;
	  }
	| {
			cursor?: string;
			failureCode?: string;
			jobId: string;
			sequence: number;
			status: string;
			type: "terminal";
	  }
	| {
			cursor?: string;
			code: string;
			jobId: string;
			message: string;
			retryable: true;
			sequence: number;
			type: "recoverable";
	  };

export async function streamCanvasTextGeneration(
	input: {
		jobId: string;
		lastEventId?: string;
		projectId: string;
	},
	options: {
		onEvent(event: CanvasTextStreamEvent): Promise<void> | void;
		signal?: AbortSignal;
	},
) {
	const response = await openCanvasTextStream(input, {
		signal: options.signal,
	});
	if (!response.ok) throw await streamError(response);
	if (
		!response.body ||
		!response.headers
			.get("content-type")
			?.toLowerCase()
			.includes("text/event-stream")
	) {
		throw new CanvasBackendError(
			"TEXT_STREAM_INVALID",
			"Canvas text stream returned an invalid response.",
			response.status,
		);
	}

	let lastEventId = input.lastEventId;
	const decoder = new TextDecoder();
	const reader = response.body.getReader();
	let buffer = "";
	let frame = emptyFrame();
	const dispatch = async () => {
		if (!frame.event || frame.data.length === 0) {
			frame = emptyFrame();
			return;
		}
		if (frame.id) lastEventId = frame.id;
		const data = parseFrameData(frame.data.join("\n"), response.status);
		if (frame.event === "canvas.text.error") {
			throw new CanvasBackendError(
				typeof data.code === "string" ? data.code : "TEXT_STREAM_FAILED",
				typeof data.message === "string"
					? data.message
					: "Canvas text stream failed.",
				response.status,
			);
		}
		if (frame.event === "canvas.text.delta") {
			const sequence = data.sequence;
			if (
				typeof data.delta === "string" &&
				typeof data.jobId === "string" &&
				typeof sequence === "number" &&
				Number.isSafeInteger(sequence)
			) {
				await options.onEvent({
					...(frame.id ? { cursor: frame.id } : {}),
					delta: data.delta,
					jobId: data.jobId,
					sequence,
					type: "delta",
				});
			}
		}
		if (frame.event === "canvas.text.terminal") {
			const sequence = data.sequence;
			if (
				typeof data.jobId === "string" &&
				typeof data.status === "string" &&
				typeof sequence === "number" &&
				Number.isSafeInteger(sequence)
			) {
				await options.onEvent({
					...(frame.id ? { cursor: frame.id } : {}),
					...(typeof data.failureCode === "string"
						? { failureCode: data.failureCode }
						: {}),
					jobId: data.jobId,
					sequence,
					status: data.status,
					type: "terminal",
				});
			}
		}
		if (frame.event === "canvas.text.recoverable") {
			const sequence = data.sequence;
			if (
				typeof data.code !== "string" ||
				typeof data.jobId !== "string" ||
				typeof data.message !== "string" ||
				data.retryable !== true ||
				typeof sequence !== "number" ||
				!Number.isSafeInteger(sequence)
			) {
				throw new CanvasBackendError(
					"TEXT_STREAM_INVALID",
					"Canvas text stream recovery event was invalid.",
					response.status,
				);
			}
			await options.onEvent({
				...(frame.id ? { cursor: frame.id } : {}),
				code: data.code,
				jobId: data.jobId,
				message: data.message,
				retryable: true,
				sequence,
				type: "recoverable",
			});
			throw new CanvasBackendError(data.code, data.message, response.status);
		}
		frame = emptyFrame();
	};
	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/u, "");
				buffer = buffer.slice(newline + 1);
				if (line.length === 0) {
					await dispatch();
				} else if (!line.startsWith(":")) {
					const separator = line.indexOf(":");
					const field = separator < 0 ? line : line.slice(0, separator);
					const value =
						separator < 0 ? "" : line.slice(separator + 1).replace(/^ /u, "");
					if (field === "id") frame.id = value;
					if (field === "event") frame.event = value;
					if (field === "data") frame.data.push(value);
				}
				newline = buffer.indexOf("\n");
			}
			if (done) break;
		}
		if (buffer.trim().length > 0) {
			const line = buffer.replace(/\r$/u, "");
			if (line.startsWith("data:"))
				frame.data.push(line.slice(5).replace(/^ /u, ""));
		}
		await dispatch();
	} finally {
		reader.releaseLock();
	}
	return { lastEventId };
}

function emptyFrame() {
	return { data: [] as string[], event: "", id: "" };
}

function parseFrameData(value: string, status: number) {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Invalid SSE data is a boundary failure, not a token to render.
	}
	throw new CanvasBackendError(
		"TEXT_STREAM_INVALID",
		"Canvas text stream event was invalid.",
		status,
	);
}

async function streamError(response: Response) {
	try {
		const payload = (await response.json()) as {
			error?: { code?: string; message?: string };
		};
		return new CanvasBackendError(
			payload.error?.code ?? "TEXT_STREAM_REJECTED",
			payload.error?.message ?? "Canvas text stream request failed.",
			response.status,
		);
	} catch {
		return new CanvasBackendError(
			"TEXT_STREAM_REJECTED",
			"Canvas text stream request failed.",
			response.status,
		);
	}
}
