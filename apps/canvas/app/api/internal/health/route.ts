import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

const responseHeaders = { "cache-control": "no-store" };

export async function GET(request: Request) {
	if (!trustedService(request.headers.get("x-canvas-service-token"))) {
		return Response.json(
			{ error: "Unauthorized" },
			{ status: 401, headers: responseHeaders },
		);
	}

	return Response.json(
		{ service: "meiye-canvas", status: "ok" },
		{ headers: responseHeaders },
	);
}

function trustedService(value: string | null) {
	const expected = process.env.CANVAS_SERVICE_TOKEN;
	if (!value || !expected) return false;
	const left = Buffer.from(value);
	const right = Buffer.from(expected);
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
