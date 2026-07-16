import assert from "node:assert/strict";
import test from "node:test";
import { LaunchCodeError } from "@meiye/core/pro-studio";
import {
	createCanvasExchangeResponse,
	createLaunchBootstrapResponse,
	createLaunchIssueErrorResponse,
} from "./launch-flow.js";

test("bootstrap binds a Secure host-only nonce cookie before form-posting to main Web", async () => {
	const response = createLaunchBootstrapResponse({
		audience: { kind: "workspace" },
		mainAppOrigin: "https://app.example.test",
		nonce: "browser-nonce",
	});
	const html = await response.text();

	assert.equal(response.status, 200);
	assert.match(
		response.headers.get("set-cookie") ?? "",
		/^__Host-canvas-launch-nonce=browser-nonce; Path=\/; HttpOnly; Secure; SameSite=Lax/,
	);
	assert.match(
		html,
		/action="https:\/\/app\.example\.test\/api\/pro-studio\/launch"/,
	);
	assert.match(html, /name="browserNonce" value="browser-nonce"/);
	assert.doesNotMatch(html, /launchCode|sessionToken/);
	assert.equal(response.headers.get("referrer-policy"), "strict-origin");
});

test("exchange sets an HttpOnly __Host session and keeps it out of the redirect URL", () => {
	const response = createCanvasExchangeResponse({
		csrfToken: "csrf-token",
		redirectPath: "/",
		sessionToken: "session-secret",
	});
	const cookies = response.headers.getSetCookie();

	assert.equal(response.status, 303);
	assert.equal(response.headers.get("location"), "/");
	assert.ok(
		cookies.some((cookie) =>
			cookie.startsWith(
				"__Host-canvas-session=session-secret; Path=/; HttpOnly; Secure; SameSite=Lax",
			),
		),
	);
	assert.ok(
		cookies.some((cookie) =>
			cookie.startsWith(
				"__Host-canvas-csrf=csrf-token; Path=/; Secure; SameSite=Lax",
			),
		),
	);
	assert.doesNotMatch(response.headers.get("location") ?? "", /session-secret/);
});

test("launch issue maps access denial without disguising it as an outage", async () => {
	const response = createLaunchIssueErrorResponse(
		new LaunchCodeError("FORBIDDEN", "Workspace access is required."),
	);

	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: "FORBIDDEN" });
});

test("launch issue survives workspace package class duplication", async () => {
	const duplicated = Object.assign(new Error("Workspace access is required."), {
		code: "FORBIDDEN",
	});
	const response = createLaunchIssueErrorResponse(duplicated);

	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: "FORBIDDEN" });
});
