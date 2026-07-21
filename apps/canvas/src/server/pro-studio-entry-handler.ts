import { timingSafeEqual } from "node:crypto";
import * as z from "zod";
import {
	canvasRouteBoundaryResponse,
	readBoundedJson,
} from "./request-boundary";

const schema = z.strictObject({
	mainSessionId: z.string().min(1),
	userId: z.string().min(1),
	workspaceId: z.string().min(1),
});

export async function handleProStudioEntryRequest(
	request: Request,
	getRuntime: () => Promise<{
		entry: {
			get(input: z.infer<typeof schema>): Promise<unknown>;
		};
	}>,
) {
	if (!trustedService(request.headers.get("x-canvas-service-token"))) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	let body: unknown;
	try {
		body = await readBoundedJson(request);
	} catch (error) {
		return canvasRouteBoundaryResponse(error);
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: "Invalid input" }, { status: 400 });
	}
	try {
		const runtime = await getRuntime();
		return Response.json(await runtime.entry.get(parsed.data), {
			headers: { "cache-control": "no-store" },
		});
	} catch (error) {
		const code = entryAccessErrorCode(error);
		const status =
			code === "SESSION_EXPIRED" ? 401 : code === "FORBIDDEN" ? 403 : 503;
		return Response.json(
			{ error: code ?? "SERVICE_UNAVAILABLE" },
			{ status, headers: { "cache-control": "no-store" } },
		);
	}
}

function entryAccessErrorCode(error: unknown) {
	if (!error || typeof error !== "object" || !("code" in error)) return null;
	return error.code === "SESSION_EXPIRED" || error.code === "FORBIDDEN"
		? error.code
		: null;
}

function trustedService(value: string | null) {
	const expected = process.env.CANVAS_SERVICE_TOKEN;
	if (!value || !expected) return false;
	const left = Buffer.from(value);
	const right = Buffer.from(expected);
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
