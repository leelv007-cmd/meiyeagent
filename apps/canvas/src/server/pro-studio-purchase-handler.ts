import { timingSafeEqual } from "node:crypto";
import * as z from "zod";
import {
	canvasRouteBoundaryResponse,
	readBoundedJson,
} from "./request-boundary";

const schema = z.strictObject({
	offerId: z.string().min(1),
	paymentEventId: z.string().min(1),
	userId: z.string().min(1),
	workspaceId: z.string().min(1),
});

export async function handleProStudioPurchaseRequest(
	request: Request,
	getRuntime: () => Promise<{
		purchases: {
			activate(input: z.infer<typeof schema>): Promise<unknown>;
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
		return Response.json(await runtime.purchases.activate(parsed.data), {
			headers: { "cache-control": "no-store" },
		});
	} catch {
		return Response.json(
			{ error: "PURCHASE_ACTIVATION_FAILED" },
			{ status: 409, headers: { "cache-control": "no-store" } },
		);
	}
}

function trustedService(value: string | null) {
	const expected = process.env.CANVAS_SERVICE_TOKEN;
	if (!value || !expected) return false;
	const left = Buffer.from(value);
	const right = Buffer.from(expected);
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
