import type {
	LaunchCodeAudience,
	LaunchCodeErrorCode,
} from "@meiye/core/pro-studio";

export const CANVAS_LAUNCH_NONCE_COOKIE = "__Host-canvas-launch-nonce";
export const CANVAS_SESSION_COOKIE = "__Host-canvas-session";
export const CANVAS_CSRF_COOKIE = "__Host-canvas-csrf";

const launchCodeErrorCodes = new Set<LaunchCodeErrorCode>([
	"FORBIDDEN",
	"INVALID_INPUT",
	"INVALID_LAUNCH_CODE",
	"NOT_FOUND",
	"SESSION_EXPIRED",
]);

export function createLaunchBootstrapResponse(input: {
	audience: LaunchCodeAudience;
	bootstrap?: {
		locale: string;
		returnTo: string;
		theme: "dark" | "light" | "system";
	};
	mainAppOrigin: string;
	nonce: string;
}) {
	const action = new URL("/api/pro-studio/launch", input.mainAppOrigin).href;
	const fields = [
		["audience", input.audience.kind],
		...(input.audience.kind === "project"
			? [["projectId", input.audience.projectId]]
			: []),
		["browserNonce", input.nonce],
		...(input.bootstrap
			? [
					["locale", input.bootstrap.locale],
					["returnTo", input.bootstrap.returnTo],
					["theme", input.bootstrap.theme],
				]
			: []),
	];
	const html = formPostHtml(action, fields);
	return new Response(html, {
		headers: {
			"cache-control": "no-store",
			"content-security-policy": `default-src 'none'; script-src 'unsafe-inline'; form-action ${new URL(input.mainAppOrigin).origin}; base-uri 'none'; frame-ancestors 'none'`,
			"content-type": "text/html; charset=utf-8",
			"referrer-policy": "strict-origin",
			"set-cookie": `${CANVAS_LAUNCH_NONCE_COOKIE}=${encodeURIComponent(input.nonce)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120`,
		},
		status: 200,
	});
}

export function createCanvasExchangeResponse(input: {
	csrfToken: string;
	redirectPath: string;
	sessionToken: string;
}) {
	const headers = new Headers({
		"cache-control": "no-store",
		location: safeRedirectPath(input.redirectPath),
		"referrer-policy": "no-referrer",
	});
	headers.append(
		"set-cookie",
		`${CANVAS_SESSION_COOKIE}=${encodeURIComponent(input.sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
	);
	headers.append(
		"set-cookie",
		`${CANVAS_CSRF_COOKIE}=${encodeURIComponent(input.csrfToken)}; Path=/; Secure; SameSite=Lax`,
	);
	headers.append(
		"set-cookie",
		`${CANVAS_LAUNCH_NONCE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
	);
	return new Response(null, { headers, status: 303 });
}

export function createLaunchIssueErrorResponse(error: unknown) {
	const code = launchCodeErrorCode(error);
	if (!code) {
		return Response.json(
			{ error: "INTERNAL_ERROR" },
			{ status: 500, headers: { "cache-control": "no-store" } },
		);
	}
	const status =
		code === "INVALID_INPUT"
			? 400
			: code === "NOT_FOUND"
				? 404
				: code === "INVALID_LAUNCH_CODE" || code === "SESSION_EXPIRED"
					? 401
					: 403;
	return Response.json(
		{ error: code },
		{ status, headers: { "cache-control": "no-store" } },
	);
}

function launchCodeErrorCode(error: unknown): LaunchCodeErrorCode | null {
	if (!error || typeof error !== "object" || !("code" in error)) return null;
	const code = error.code;
	return typeof code === "string" &&
		launchCodeErrorCodes.has(code as LaunchCodeErrorCode)
		? (code as LaunchCodeErrorCode)
		: null;
}

function formPostHtml(action: string, fields: string[][]) {
	const inputs = fields
		.map(
			([name, value]) =>
				`<input type="hidden" name="${escapeHtml(name ?? "")}" value="${escapeHtml(value ?? "")}">`,
		)
		.join("");
	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="strict-origin"><title>正在进入 Pro Studio</title></head><body><form id="launch" method="post" action="${escapeHtml(action)}">${inputs}<noscript><button type="submit">继续进入 Pro Studio</button></noscript></form><script>document.getElementById('launch').submit()</script></body></html>`;
}

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function safeRedirectPath(value: string) {
	return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
