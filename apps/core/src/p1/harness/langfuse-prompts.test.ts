import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
	assertLangfusePromptRuntimePolicy,
	HARNESS_BUILTIN_PROMPTS,
	HARNESS_CORE_PROMPT_KEYS,
	HARNESS_LANGFUSE_PROMPT_NAMES,
	HARNESS_PROMPT_SITE_COUNT,
	HARNESS_PROMPT_SITES,
	harnessPromptCapabilityRequirement,
	LangfuseHarnessPromptResolver,
	XHS_VERTICAL_PROMPT_KEYS,
} from "./langfuse-prompts.js";

test("the single registry owns prompt names and capability requirements (14 core + 8 xhs)", () => {
	assert.deepEqual(
		Object.keys(HARNESS_PROMPT_SITES).sort(),
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).sort(),
	);
	assert.equal(
		Object.keys(HARNESS_PROMPT_SITES).length,
		HARNESS_PROMPT_SITE_COUNT,
	);
	assert.equal(HARNESS_CORE_PROMPT_KEYS.length, 14);
	assert.equal(XHS_VERTICAL_PROMPT_KEYS.length, 8);
	assert.equal(HARNESS_PROMPT_SITE_COUNT, 22);

	// CORE ∪ XHS must equal site keys exactly; CORE ∩ XHS must be empty.
	const coreSet = new Set<string>(HARNESS_CORE_PROMPT_KEYS);
	const xhsSet = new Set<string>(XHS_VERTICAL_PROMPT_KEYS);
	const union = [...coreSet, ...xhsSet].sort();
	assert.deepEqual(union, Object.keys(HARNESS_PROMPT_SITES).sort());
	assert.equal(new Set(union).size, HARNESS_PROMPT_SITE_COUNT);
	assert.equal(
		[...coreSet].filter((key) => xhsSet.has(key)).length,
		0,
		"CORE and XHS key partitions must be disjoint",
	);

	assert.deepEqual(
		Object.fromEntries(
			Object.entries(HARNESS_PROMPT_SITES).map(([key, site]) => [
				key,
				site.name,
			]),
		),
		HARNESS_LANGFUSE_PROMPT_NAMES,
	);

	for (const key of XHS_VERTICAL_PROMPT_KEYS) {
		assert.equal(
			HARNESS_PROMPT_SITES[key].name,
			`harness/xhs-${kebabFromXhsKey(key)}`,
		);
		assert.ok(HARNESS_BUILTIN_PROMPTS[key].length > 80);
	}

	assert.deepEqual(harnessPromptCapabilityRequirement("briefImage"), {
		axisId: "briefImage",
		vocabularyVersion: "model-capability-v1",
		requiredProtocolCapabilities: ["structured-output"],
		requiredModalities: ["text/plain"],
		requiredBusinessTags: [],
		requiredModalityCapabilities: [],
		unknownPolicy: "conservative_always_available",
	});
	assert.deepEqual(harnessPromptCapabilityRequirement("textResponse"), {
		axisId: "textResponse",
		vocabularyVersion: "model-capability-v1",
		requiredProtocolCapabilities: [],
		requiredModalities: ["text/plain"],
		requiredBusinessTags: [],
		requiredModalityCapabilities: [],
		unknownPolicy: "conservative_always_available",
	});
	assert.deepEqual(
		harnessPromptCapabilityRequirement("textResponse", {
			referenceImage: true,
		}).requiredModalities,
		["text/plain", "image/*"],
	);
	// XHS style analysis keeps text/plain on the base pin; vision is opt-in.
	assert.deepEqual(
		harnessPromptCapabilityRequirement("xhsStyleAnalysis").requiredModalities,
		["text/plain"],
	);
	assert.deepEqual(
		harnessPromptCapabilityRequirement("xhsStyleAnalysis", {
			referenceImage: true,
		}).requiredModalities,
		["text/plain", "image/*"],
	);
});

test("XHS vertical builtins are beauty-rewritten and not generic xhswork clones", () => {
	const genericLeakMarkers = [
		"京都穷游",
		"冰岛极光",
		"迪拜奢华",
		"xiaohongshu（小红书风）",
		"collage（拼图对比）",
	];
	const beautyMarkers = ["美业", "门店", "小红书"];

	for (const key of XHS_VERTICAL_PROMPT_KEYS) {
		const content = HARNESS_BUILTIN_PROMPTS[key];
		for (const leak of genericLeakMarkers) {
			assert.equal(
				content.includes(leak),
				false,
				`${key} must not retain unrewritten generic marker: ${leak}`,
			);
		}
		assert.ok(
			beautyMarkers.some((marker) => content.includes(marker)),
			`${key} must carry beauty-industry framing`,
		);
	}

	for (const preset of [
		"beauty_soft",
		"beauty_editorial",
		"before_after",
		"spa_minimal",
		"salon_photo",
	]) {
		assert.match(
			HARNESS_BUILTIN_PROMPTS.xhsCoverPrompt,
			new RegExp(preset, "u"),
			`cover builtin must document beauty preset ${preset}`,
		);
	}
	// Aligned tag protocol: no leading # on tag tokens (same as xhsContent).
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsContent, /【标签】标签1 标签2/);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsNoteGen, /【标签】标签1 标签2/);
	assert.equal(
		HARNESS_BUILTIN_PROMPTS.xhsNoteGen.includes("【标签】#标签"),
		false,
	);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsOutline, /\{topic\}/);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsOutline, /\{pageCount\}/);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsImagePrompt, /\{pageContent\}/);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsNoteGen, /\{tone\}/);
});

test("XHS vertical sites resolve with version pin and pilot builtin fallback", async (t) => {
	const server = createServer((request, response) => {
		const name = decodeURIComponent(
			request.url?.split("/api/public/v2/prompts/")[1]?.split("?")[0] ?? "",
		);
		sendJson(response, 200, {
			name,
			version: 3,
			type: "text",
			prompt: `Langfuse pinned body for ${name} with enough production detail.`,
		});
	});
	const baseUrl = await listen(t, server);

	const strict = new LangfuseHarnessPromptResolver({
		baseUrl,
		publicKey: "pk-prompt",
		secretKey: "sk-prompt",
		policy: "strict",
		versions: promptVersions(() => 3),
	});
	const frozenStrict = await strict.resolve();
	for (const key of XHS_VERTICAL_PROMPT_KEYS) {
		assert.equal(frozenStrict[key].isFallback, false);
		assert.equal(frozenStrict[key].source, "langfuse");
		assert.equal(frozenStrict[key].version, "3");
		assert.equal(frozenStrict[key].name, HARNESS_LANGFUSE_PROMPT_NAMES[key]);
		assert.match(frozenStrict[key].contentHash, /^[a-f0-9]{64}$/u);
	}

	const warnings: Array<{ name: string; reason: string }> = [];
	const pilot = new LangfuseHarnessPromptResolver({
		policy: "pilot",
		warn: (warning) => warnings.push(warning),
	});
	const frozenPilot = await pilot.resolve();
	for (const key of XHS_VERTICAL_PROMPT_KEYS) {
		assert.equal(frozenPilot[key].isFallback, true);
		assert.equal(frozenPilot[key].source, "builtin");
		assert.equal(frozenPilot[key].version, "builtin-v1");
		assert.equal(frozenPilot[key].fallbackReason, "unconfigured");
		assert.equal(frozenPilot[key].content, HARNESS_BUILTIN_PROMPTS[key]);
	}
	assert.ok(
		warnings.some(
			(warning) =>
				warning.name === HARNESS_LANGFUSE_PROMPT_NAMES.xhsOutline &&
				warning.reason === "unconfigured",
		),
	);
});

test("strict policy rejects incomplete pins including new XHS vertical keys", () => {
	// All keys pinned except one XHS key — must name xhsOutline specifically.
	const pinsMissingXhsOutline = Object.fromEntries(
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES)
			.filter((key) => key !== "xhsOutline")
			.map((key) => [key, 1]),
	);
	assert.throws(
		() =>
			assertLangfusePromptRuntimePolicy({
				LANGFUSE_BASE_URL: "https://langfuse.example",
				LANGFUSE_PUBLIC_KEY: "pk-prompt",
				LANGFUSE_SECRET_KEY: "sk-prompt",
				LANGFUSE_PROMPT_VERSIONS: JSON.stringify(pinsMissingXhsOutline),
			}),
		/xhsOutline/u,
	);

	const completePins = Object.fromEntries(
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).map((key) => [key, 1]),
	);
	assert.doesNotThrow(() =>
		assertLangfusePromptRuntimePolicy({
			LANGFUSE_BASE_URL: "https://langfuse.example",
			LANGFUSE_PUBLIC_KEY: "pk-prompt",
			LANGFUSE_SECRET_KEY: "sk-prompt",
			LANGFUSE_PROMPT_VERSIONS: JSON.stringify(completePins),
		}),
	);
});

test("production base prompts must come from the registry (anti-drift)", () => {
	// Every registered site has a non-empty builtin and a stable Langfuse name.
	// Downstream production code must freeze via LangfuseHarnessPromptResolver /
	// HARNESS_BUILTIN_PROMPTS rather than re-embedding base templates.
	for (const key of Object.keys(HARNESS_PROMPT_SITES) as Array<
		keyof typeof HARNESS_PROMPT_SITES
	>) {
		const site = HARNESS_PROMPT_SITES[key];
		const builtin = HARNESS_BUILTIN_PROMPTS[key];
		assert.equal(typeof site.name, "string");
		assert.match(site.name, /^harness\//u);
		assert.equal(typeof builtin, "string");
		assert.ok(builtin.trim().length > 40, `${key} builtin too short`);
		assert.equal(HARNESS_LANGFUSE_PROMPT_NAMES[key], site.name);
	}

	// XHS vertical sites are part of the same pin set — no shadow inline catalog.
	assert.deepEqual([...XHS_VERTICAL_PROMPT_KEYS].sort(), [
		"xhsContent",
		"xhsCoverPrompt",
		"xhsImagePrompt",
		"xhsNoteGen",
		"xhsOutline",
		"xhsStyleAnalysis",
		"xhsViralImageVision",
		"xhsViralRewrite",
	]);
});

test("viral adapt prompts stay paste-track honest (no scrape language)", () => {
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsViralRewrite, /粘贴/u);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsViralRewrite, /note-plan\/v1/u);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsViralRewrite, /\{sourceNote\}/u);
	assert.doesNotMatch(
		HARNESS_BUILTIN_PROMPTS.xhsViralRewrite,
		/"sourceTrack"\s*:\s*"paste"/u,
	);
	assert.doesNotMatch(
		HARNESS_BUILTIN_PROMPTS.xhsViralRewrite,
		/fetchNote|__INITIAL_STATE__|x-s\s*sign/u,
	);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsViralRewrite, /禁止假设存在未授权/u);
	assert.match(HARNESS_BUILTIN_PROMPTS.xhsViralImageVision, /上传/u);
	assert.match(
		HARNESS_LANGFUSE_PROMPT_NAMES.xhsViralRewrite,
		/xhs-viral-rewrite/u,
	);
	assert.match(
		HARNESS_LANGFUSE_PROMPT_NAMES.xhsViralImageVision,
		/xhs-viral-image-vision/u,
	);
});

test("strict prompt policy is the default and rejects missing runtime configuration", () => {
	assert.throws(
		() => assertLangfusePromptRuntimePolicy({}),
		/LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_PROMPT_VERSIONS/u,
	);
	assert.throws(
		() =>
			assertLangfusePromptRuntimePolicy({
				LANGFUSE_BASE_URL: "https://langfuse.example",
				LANGFUSE_PUBLIC_KEY: "pk-prompt",
				LANGFUSE_SECRET_KEY: "sk-prompt",
				LANGFUSE_PROMPT_VERSIONS: JSON.stringify({ intentNaming: 7 }),
			}),
		/briefCompilation/u,
	);
	assert.throws(
		() =>
			assertLangfusePromptRuntimePolicy({
				LANGFUSE_PROMPT_POLICY: "development",
			}),
		/LANGFUSE_PROMPT_POLICY/u,
	);
});

test("strict prompt resolver fetches every prompt by an explicit version", async (t) => {
	const requests: Array<{ url?: string; authorization?: string }> = [];
	const server = createServer((request, response) => {
		requests.push({
			url: request.url,
			authorization: request.headers.authorization,
		});
		const name = decodeURIComponent(
			request.url?.split("/api/public/v2/prompts/")[1]?.split("?")[0] ?? "",
		);
		if (name === HARNESS_LANGFUSE_PROMPT_NAMES.intentNaming) {
			sendJson(response, 200, {
				name,
				version: 7,
				type: "text",
				prompt: "Intent prompt v7 with exact production instructions.",
			});
			return;
		}
		sendJson(response, 200, {
			name,
			version: 12,
			type: "text",
			prompt: "Brief prompt v12 with exact production instructions.",
		});
	});
	const resolver = new LangfuseHarnessPromptResolver({
		baseUrl: await listen(t, server),
		publicKey: "pk-prompt",
		secretKey: "sk-prompt",
		policy: "strict",
		versions: promptVersions((key) => (key === "intentNaming" ? 7 : 12)),
	});

	const frozen = await resolver.resolve();

	assert.deepEqual(frozen.intentNaming, {
		name: "harness/intent-naming",
		version: "7",
		content: "Intent prompt v7 with exact production instructions.",
		contentHash:
			"87e6d5912c32be17fc537293f6267b956b247dae38f1b63e2b8f7bc50e49ca7a",
		label: "production",
		source: "langfuse",
		isFallback: false,
	});
	assert.equal(frozen.briefCompilation.version, "12");
	assert.equal(
		frozen.briefCompilation.contentHash,
		"b59c9b4683cb2d152f857740cb518dacb2e2de5aa108114e4c5adf59f955431a",
	);
	assert.deepEqual(
		requests.map(({ url }) => url).sort(),
		Object.values(HARNESS_LANGFUSE_PROMPT_NAMES)
			.map(
				(name, index) =>
					`/api/public/v2/prompts/${encodeURIComponent(name)}?version=${index === 0 ? 7 : 12}`,
			)
			.sort(),
	);
	assert.ok(requests.every(({ url }) => !url?.includes("label=")));
	assert.ok(
		requests.every(
			({ authorization }) =>
				authorization ===
				`Basic ${Buffer.from("pk-prompt:sk-prompt").toString("base64")}`,
		),
	);
});

test("strict prompt resolver checks the complete pin set before any remote request", async () => {
	let requests = 0;
	const resolver = new LangfuseHarnessPromptResolver({
		baseUrl: "https://langfuse.example",
		fetch: async () => {
			requests += 1;
			return new Response();
		},
		publicKey: "pk-prompt",
		secretKey: "sk-prompt",
		policy: "strict",
		versions: { intentNaming: 7 },
	});

	await assert.rejects(resolver.resolve(), /briefCompilation/u);
	assert.equal(requests, 0);
});

test("configured prompt versions are fetched by version and surfaced as immutable references", async (t) => {
	const requests: string[] = [];
	const warnings: Array<{ name: string; reason: string }> = [];
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		sendJson(response, 200, {
			version: 9,
			type: "text",
			prompt: "Pinned prompt content with enough detail for the fixture.",
		});
	});
	const resolver = new LangfuseHarnessPromptResolver({
		baseUrl: await listen(t, server),
		publicKey: "pk-prompt",
		secretKey: "sk-prompt",
		policy: "pilot",
		versions: { intentNaming: 9 },
		warn: (warning) => warnings.push(warning),
	});

	const frozen = await resolver.resolve();

	assert.ok(
		requests.includes(
			"/api/public/v2/prompts/harness%2Fintent-naming?version=9",
		),
	);
	assert.equal(frozen.intentNaming.version, "9");
	assert.equal(frozen.intentNaming.isFallback, false);
	assert.equal(frozen.briefCompilation.isFallback, true);
	assert.equal(frozen.briefCompilation.fallbackReason, "unpinned");
	assert.equal(requests.length, 1);
	assert.equal(
		warnings.length,
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length - 1,
	);
	assert.ok(warnings.every(({ reason }) => reason === "unpinned"));
});

test("only explicit pilot policy permits missing configuration to fall back", async () => {
	const warnings: Array<{ name: string; reason: string }> = [];
	const resolver = new LangfuseHarnessPromptResolver({
		policy: "pilot",
		warn: (warning) => warnings.push(warning),
	});

	const frozen = await resolver.resolve();

	assert.equal(
		warnings.length,
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length,
	);
	assert.ok(warnings.every(({ reason }) => reason === "unconfigured"));
	assert.ok(Object.values(frozen).every((prompt) => prompt.isFallback));
});

test("pilot fallback emits a warning even when no warning callback is injected", async () => {
	const warnings: string[] = [];
	const originalWarn = console.warn;
	console.warn = (message) => warnings.push(String(message));
	try {
		await new LangfuseHarnessPromptResolver({ policy: "pilot" }).resolve();
	} finally {
		console.warn = originalWarn;
	}

	assert.equal(
		warnings.length,
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length,
	);
	assert.ok(warnings.every((warning) => warning.includes("(unconfigured)")));
});

test("Langfuse prompt failure freezes built-in content and an explicit fallback fact", async (t) => {
	const server = createServer((_request, response) => {
		sendJson(response, 503, { error: "unavailable" });
	});
	const warnings: Array<{ name: string; reason: string }> = [];
	const resolver = new LangfuseHarnessPromptResolver({
		baseUrl: await listen(t, server),
		publicKey: "pk-prompt",
		secretKey: "sk-prompt",
		policy: "pilot",
		versions: promptVersions(() => 9),
		warn: (warning) => warnings.push(warning),
	});

	const frozen = await resolver.resolve();

	for (const prompt of [frozen.intentNaming, frozen.briefCompilation]) {
		assert.equal(prompt.version, "builtin-v1");
		assert.equal(prompt.source, "builtin");
		assert.equal(prompt.isFallback, true);
		assert.equal(prompt.fallbackReason, "http_503");
		assert.ok(prompt.content.length > 80);
		assert.match(prompt.contentHash, /^[a-f0-9]{64}$/u);
	}
	assert.equal(
		warnings.length,
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length,
	);
	assert.ok(warnings.every(({ reason }) => reason === "http_503"));
});

test("strict prompt resolution fails closed instead of using a builtin on remote failure", async (t) => {
	const server = createServer((_request, response) => {
		sendJson(response, 503, { error: "unavailable" });
	});
	const resolver = new LangfuseHarnessPromptResolver({
		baseUrl: await listen(t, server),
		publicKey: "pk-prompt",
		secretKey: "sk-prompt",
		policy: "strict",
		versions: promptVersions(() => 9),
	});

	await assert.rejects(resolver.resolve(), /http_503/u);
});

function promptVersions(
	versionFor: (key: keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES) => number,
) {
	return Object.fromEntries(
		Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).map((key) => [
			key,
			versionFor(key as keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES),
		]),
	) as Record<keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES, number>;
}

function kebabFromXhsKey(key: (typeof XHS_VERTICAL_PROMPT_KEYS)[number]) {
	// xhsOutline → outline, xhsImagePrompt → image-prompt, xhsNoteGen → note-gen
	const withoutPrefix = key.slice("xhs".length);
	return withoutPrefix
		.replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
		.replace(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
		.toLowerCase();
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

async function listen(
	t: test.TestContext,
	server: ReturnType<typeof createServer>,
) {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	);
	const { port } = server.address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
}
