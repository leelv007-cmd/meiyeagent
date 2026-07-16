import { cookies } from "next/headers";
import { CANVAS_SESSION_COOKIE } from "@/src/server/launch-flow";
import { canvasRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ action: string }> };

export async function GET(request: Request, context: RouteContext) {
	return handle(request, context);
}

export async function POST(request: Request, context: RouteContext) {
	return handle(request, context);
}

async function handle(request: Request, context: RouteContext) {
	const [{ action }, cookieStore, runtime] = await Promise.all([
		context.params,
		cookies(),
		canvasRuntime(),
	]);
	return runtime.backend.handle(
		action,
		request,
		cookieStore.get(CANVAS_SESSION_COOKIE)?.value,
	);
}
