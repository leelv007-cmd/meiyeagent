/**
 * V31-91: every refusal `startPrepared` raises must be separable at the HTTP
 * boundary.
 *
 * The route wraps the whole command in a blanket handler that turns any throw
 * into one `COMPOSER_PLAN_START_FAILED` 409 and drops the message
 * (`apps/core/src/composer-plan-route-registrar.ts:88-100` builds that fallback
 * code by template literal, which is why the literal string appears nowhere in
 * `apps/core`; `apps/core/src/http-errors.ts:107-114` is the fallback return).
 * Ten refusals used to be bare `throw new Error(...)`, so a red gate could not
 * say which one fired — and two pairs shared a message verbatim, so surfacing
 * text alone would not have separated them either.
 *
 * This guards the property, not one instance: no bare throw may come back, and
 * no two refusals may share a code. The last two tests guard the seam the whole
 * change depends on — that a coded refusal actually survives the envelope.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { toHttpError } from "../../http-errors.js";
import { ComposerPlanStartRefusedError } from "./submission-coordinator.js";

// The exact fallback `registerComposerPlanCommandRoutes` builds for `start`
// (`apps/core/src/composer-plan-route-registrar.ts:90-99`).
const START_FALLBACK = {
	code: "COMPOSER_PLAN_START_FAILED",
	message: "Composer plan could not be started.",
	status: 409,
} as const;

/**
 * Both refusal sites, scoped by brace depth. Scoping matters: `if (!run) throw
 * new Error(...)` appears three times in the session file, so a file-wide edit
 * or a file-wide assertion would silently target the wrong method.
 */
const SITES = [
	{ file: "./submission-coordinator.ts", method: "async startPrepared(input: {" },
	{
		file: "../agent-session/composer-plan-session.ts",
		method: "async completeExplicitStart(input: {",
	},
] as const;

function methodBody(file: string, method: string): string {
	const source = readFileSync(
		fileURLToPath(new URL(file, import.meta.url)),
		"utf8",
	);
	const lines = source.split("\n");
	const start = lines.findIndex((line) => line.trim().startsWith(method));
	assert.ok(start >= 0, `${method} must exist in ${file}`);
	let depth = 0;
	let opened = false;
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		depth += (line.match(/\{/gu) ?? []).length;
		depth -= (line.match(/\}/gu) ?? []).length;
		if (!opened && line.includes("{")) opened = true;
		if (opened && depth <= 0) return lines.slice(start, index + 1).join("\n");
	}
	assert.fail(`${method} must close in ${file}`);
}

function startCommandBody(): string {
	return SITES.map((site) => methodBody(site.file, site.method)).join("\n");
}

test("the start command raises no refusal the HTTP boundary cannot name", () => {
	for (const site of SITES) {
		const body = methodBody(site.file, site.method);
		assert.equal(
			(body.match(/throw new Error\(/gu) ?? []).length,
			0,
			`${site.method} still has a bare Error, which collapses into the generic COMPOSER_PLAN_START_FAILED 409`,
		);
	}
	const refusals = (
		startCommandBody().match(/throw new ComposerPlanStartRefusedError\(/gu) ?? []
	).length;
	assert.ok(refusals >= 15, `expected every refusal coded, saw ${refusals}`);
});

test("no two start-command refusals share a code", () => {
	// The two files disagree on quote style (tabs/double vs spaces/single), so
	// match both rather than silently seeing only half the codes.
	const codes =
		startCommandBody().match(/["']COMPOSER_PLAN_START_[A-Z_]+["']/gu) ?? [];
	assert.equal(
		new Set(codes).size,
		codes.length,
		`duplicate refusal codes: ${codes.join(", ")}`,
	);
});

test("the two refusals that shared a message stay separable", () => {
	const body = startCommandBody();
	// :691 checked planAuthority, :718 checked authority.request, and both said
	// "requires the exact prepared plan authority". Likewise the pair that both
	// said "requires an immutable confirmed decision".
	for (const code of [
		"COMPOSER_PLAN_START_PLAN_AUTHORITY_MISMATCH",
		"COMPOSER_PLAN_START_REQUEST_MISMATCH",
		"COMPOSER_PLAN_START_NOT_DECIDED",
		"COMPOSER_PLAN_START_DECISION_NOT_CONFIRMED",
	]) {
		assert.equal(
			(body.match(new RegExp(`["']${code}["']`, "gu")) ?? []).length,
			1,
			`${code} must name exactly one refusal`,
		);
	}
});

test("refusal messages stay renderable to a merchant", () => {
	const messages = [
		...startCommandBody().matchAll(
			/new ComposerPlanStartRefusedError\(\s*["'][A-Z_]+["'],\s*["']([^"']+)["']/gu,
		),
	].map((match) => match[1] ?? "");
	assert.ok(messages.length >= 15, `expected 15 messages, saw ${messages.length}`);
	for (const message of messages) {
		// merchantMessageFromP1 drops anything with a run of four Latin letters
		// or an internal identifier, falling back to generic copy
		// (mkfast-template-main/src/p1/merchant-p1-error.ts:15,24-27).
		assert.ok(
			!/[A-Za-z]{4,}/u.test(message),
			`merchant copy would be dropped: ${message}`,
		);
		assert.ok(
			!/admitted|composer-task:|ExecutionPlanSnapshot|snapshotHash/iu.test(
				message,
			),
			`merchant copy leaks an internal identifier: ${message}`,
		);
	}
});

test("a coded refusal survives the blanket handler that flattened it", () => {
	const refusal = new ComposerPlanStartRefusedError(
		"COMPOSER_PLAN_START_NOT_DECIDED",
		"方案确认还没落实，请稍等一下再开始。",
	);
	const http = toHttpError(refusal, START_FALLBACK);
	assert.equal(http.code, "COMPOSER_PLAN_START_NOT_DECIDED");
	assert.equal(http.status, 409);
	// `isHttpErrorShaped` keeps `error.message` because the start fallback sets
	// no `shapedMessage: 'fallback'` (`http-errors.ts:96-106`). If someone adds
	// it, merchants silently get the English fallback again.
	assert.equal(http.message, "方案确认还没落实，请稍等一下再开始。");
});

test("a bare throw still collapses, which is why the codes were needed", () => {
	// Pins the reason for the change, so nobody "fixes" a future red by widening
	// the fallback instead of coding the refusal.
	const http = toHttpError(
		new Error("Prepared Composer task was not found."),
		START_FALLBACK,
	);
	assert.equal(http.code, "COMPOSER_PLAN_START_FAILED");
	assert.equal(http.status, 409);
	assert.equal(http.message, "Composer plan could not be started.");
});
