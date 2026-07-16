import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CanvasShell } from "@/src/client/canvas-shell";
import { CANVAS_SESSION_COOKIE } from "@/src/server/launch-flow";
import { canvasRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export default async function CanvasPage() {
	const [cookieStore, runtime] = await Promise.all([
		cookies(),
		canvasRuntime(),
	]);
	const sessionToken = cookieStore.get(CANVAS_SESSION_COOKIE)?.value;
	if (!sessionToken) redirect("/launch");
	try {
		const context = await runtime.sessions.authenticate(sessionToken);
		const returnUrl = new URL(
			context.bootstrap?.returnTo ?? "/dashboard",
			process.env.MAIN_APP_ORIGIN ?? "http://127.0.0.1:3000",
		).href;
		return <CanvasShell context={context} returnUrl={returnUrl} />;
	} catch {
		redirect("/launch");
	}
}
