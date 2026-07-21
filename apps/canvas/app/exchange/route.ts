import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
	CANVAS_LAUNCH_NONCE_COOKIE,
	createCanvasExchangeResponse,
} from "@/src/server/launch-flow";
import {
	canvasRouteBoundaryResponse,
	readBoundedFormData,
} from "@/src/server/request-boundary";
import { canvasRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const cookieStore = await cookies();
	const browserNonce = cookieStore.get(CANVAS_LAUNCH_NONCE_COOKIE)?.value;
	if (!browserNonce) {
		return Response.json({ error: "Invalid launch exchange" }, { status: 400 });
	}
	let form: FormData;
	try {
		form = await readBoundedFormData(request);
	} catch (error) {
		return canvasRouteBoundaryResponse(error);
	}
	const code = form.get("code");
	if (typeof code !== "string") {
		return Response.json({ error: "Invalid launch exchange" }, { status: 400 });
	}
	try {
		const runtime = await canvasRuntime();
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
