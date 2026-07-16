import { randomBytes } from "node:crypto";
import { createLaunchBootstrapResponse } from "@/src/server/launch-flow";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
	const url = new URL(request.url);
	const projectId = url.searchParams.get("projectId");
	const requestedAudience = url.searchParams.get("audience");
	const audience =
		requestedAudience === "project" && projectId
			? ({ kind: "project", projectId } as const)
			: ({ kind: "workspace" } as const);
	return createLaunchBootstrapResponse({
		audience,
		mainAppOrigin: process.env.MAIN_APP_ORIGIN ?? "http://127.0.0.1:3000",
		nonce: randomBytes(32).toString("base64url"),
		bootstrap: {
			locale: normalizeLocale(url.searchParams.get("locale")),
			returnTo: safeReturnTo(url.searchParams.get("returnTo")),
			theme: normalizeTheme(url.searchParams.get("theme")),
		},
	});
}

function normalizeTheme(value: string | null) {
	return value === "dark" || value === "light" ? value : "system";
}

function normalizeLocale(value: string | null) {
	return value && /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(value) ? value : "zh-CN";
}

function safeReturnTo(value: string | null) {
	return value?.startsWith("/") && !value.startsWith("//")
		? value
		: "/dashboard";
}
