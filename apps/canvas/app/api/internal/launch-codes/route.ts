import { timingSafeEqual } from "node:crypto";
import * as z from "zod";
import { createLaunchIssueErrorResponse } from "@/src/server/launch-flow";
import { canvasRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

const schema = z.strictObject({
	audience: z.discriminatedUnion("kind", [
		z.strictObject({ kind: z.literal("workspace") }),
		z.strictObject({
			kind: z.literal("project"),
			projectId: z.string().min(1),
		}),
	]),
	bootstrap: z.strictObject({
		locale: z.string().min(2).max(20),
		returnTo: z.string().startsWith("/"),
		theme: z.enum(["dark", "light", "system"]),
	}),
	browserNonce: z.string().min(32).max(200),
	mainSessionId: z.string().min(1),
	userId: z.string().min(1),
	workspaceId: z.string().min(1),
});

export async function POST(request: Request) {
	if (!trustedService(request.headers.get("x-canvas-service-token"))) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({ error: "Invalid input" }, { status: 400 });
	}
	const runtime = await canvasRuntime();
	try {
		const issued = await runtime.launch.issue(parsed.data);
		return Response.json(issued, {
			headers: {
				"cache-control": "no-store",
				"referrer-policy": "no-referrer",
			},
		});
	} catch (error) {
		return createLaunchIssueErrorResponse(error);
	}
}

function trustedService(value: string | null) {
	const expected = process.env.CANVAS_SERVICE_TOKEN;
	if (!value || !expected) return false;
	const left = Buffer.from(value);
	const right = Buffer.from(expected);
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
