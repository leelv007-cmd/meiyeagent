import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
	CANVAS_LAUNCH_NONCE_COOKIE,
	createCanvasExchangeResponse,
} from "@/src/server/launch-flow";
import { canvasRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const [form, cookieStore, runtime] = await Promise.all([
		request.formData(),
		cookies(),
		canvasRuntime(),
	]);
	const code = form.get("code");
	const browserNonce = cookieStore.get(CANVAS_LAUNCH_NONCE_COOKIE)?.value;
	if (typeof code !== "string" || !browserNonce) {
		return Response.json({ error: "Invalid launch exchange" }, { status: 400 });
	}
	try {
		const exchanged = await runtime.launch.exchange({ browserNonce, code });
		return createCanvasExchangeResponse({
			csrfToken: randomBytes(32).toString("base64url"),
			redirectPath: "/",
			sessionToken: exchanged.sessionToken,
		});
	} catch {
		return Response.json(
			{ error: "Launch code is invalid or expired" },
			{ status: 401, headers: { "cache-control": "no-store" } },
		);
	}
}
