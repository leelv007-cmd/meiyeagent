import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
	observabilityAxesSchema,
	promptRevisionRefSchema,
} from '@meiye/contracts';

import {
	HARNESS_LANGFUSE_PROMPT_NAMES,
	HARNESS_PROMPT_SITE_COUNT,
	HARNESS_PROMPT_SITES,
	LangfuseHarnessPromptResolver,
	type HarnessPromptKey,
} from './langfuse-prompts.js';
import {
	assertHarnessPromptPackCoverage,
	assertProductionReleasePromptResolvable,
	collectPromptFallbackAuditSignals,
	collectUncoveredRegistryKeys,
	COPY_TASK_PROMPT_PACK_IDS,
	defaultPromptPackBindings,
	flatPromptVersionAxes,
	HARNESS_PROMPT_PACK_IDS,
	HARNESS_PROMPT_PACKS,
	promptKeysForAllPacks,
	promptKeysForPacks,
	validateReleasePromptPublish,
	type HarnessPromptPackId,
} from './prompt-packs.js';

test('prompt packs cover all 22 registry keys including briefImage and xhsNoteGen', () => {
	assert.equal(collectUncoveredRegistryKeys().length, 0);
	assert.doesNotThrow(() => assertHarnessPromptPackCoverage());

	const covered = new Set<string>();
	for (const packId of HARNESS_PROMPT_PACK_IDS) {
		for (const key of HARNESS_PROMPT_PACKS[packId]) {
			assert.ok(
				key in HARNESS_PROMPT_SITES,
				`pack ${packId} key ${key} must be a registry site`,
			);
			covered.add(key);
		}
	}
	assert.equal(covered.size, HARNESS_PROMPT_SITE_COUNT);
	assert.equal(HARNESS_PROMPT_SITE_COUNT, 22);
	assert.ok(covered.has('briefImage'));
	assert.ok(covered.has('xhsNoteGen'));
	assert.deepEqual(promptKeysForAllPacks().sort(), Object.keys(HARNESS_PROMPT_SITES).sort());

	// Exact §29.2 membership for the BLOCK-05 sites.
	assert.ok(HARNESS_PROMPT_PACKS.media.includes('briefImage'));
	assert.ok(HARNESS_PROMPT_PACKS.note.includes('xhsNoteGen'));
	assert.deepEqual([...HARNESS_PROMPT_PACKS.media], ['briefImage']);
	assert.ok(HARNESS_PROMPT_PACKS.viral.includes('xhsViralRewrite'));
	assert.ok(HARNESS_PROMPT_PACKS.viral.includes('xhsViralImageVision'));
});

test('pack membership is a partition of the registry (no duplicate keys across packs)', () => {
	const seen = new Map<string, HarnessPromptPackId>();
	for (const packId of HARNESS_PROMPT_PACK_IDS) {
		for (const key of HARNESS_PROMPT_PACKS[packId]) {
			assert.equal(
				seen.has(key),
				false,
				`key ${key} appears in both ${seen.get(key)} and ${packId}`,
			);
			seen.set(key, packId);
		}
	}
	assert.equal(seen.size, HARNESS_PROMPT_SITE_COUNT);
});

test('selective pack keys for pure copy tasks exclude viral and cover sites', () => {
	const copyKeys = promptKeysForPacks(COPY_TASK_PROMPT_PACK_IDS);
	assert.ok(copyKeys.includes('copyGeneration'));
	assert.ok(copyKeys.includes('intentNaming'));
	assert.equal(copyKeys.includes('xhsViralRewrite'), false);
	assert.equal(copyKeys.includes('xhsViralImageVision'), false);
	assert.equal(copyKeys.includes('xhsCoverPrompt'), false);
	assert.equal(copyKeys.includes('briefImage'), false);

	const noteKeys = promptKeysForPacks(['agentControl', 'note']);
	assert.ok(noteKeys.includes('xhsNoteGen'));
	assert.ok(noteKeys.includes('notePlan'));
	assert.equal(noteKeys.includes('xhsViralRewrite'), false);
});

test('selective resolver freezes only requested pack keys (copy not blocked by viral pin hole)', async (t) => {
	const requested = new Set(promptKeysForPacks(COPY_TASK_PROMPT_PACK_IDS));
	const server = createServer((request, response) => {
		const name = decodeURIComponent(
			request.url?.split('/api/public/v2/prompts/')[1]?.split('?')[0] ?? '',
		);
		sendJson(response, 200, {
			name,
			version: 4,
			type: 'text',
			prompt: `Pinned body for ${name} with enough production detail for freeze.`,
		});
	});
	const baseUrl = await listen(t, server);

	// Pin only copy-task keys; viral deliberately absent.
	const versions = Object.fromEntries(
		[...requested].map((key) => [key, 4]),
	) as Partial<Record<HarnessPromptKey, number>>;

	const resolver = new LangfuseHarnessPromptResolver({
		baseUrl,
		publicKey: 'pk-prompt',
		secretKey: 'sk-prompt',
		policy: 'strict',
		versions,
	});

	const frozen = await resolver.resolveKeys([...requested]);
	assert.deepEqual(Object.keys(frozen).sort(), [...requested].sort());
	for (const key of requested) {
		assert.equal(frozen[key]?.isFallback, false);
		assert.equal(frozen[key]?.source, 'langfuse');
		assert.equal(frozen[key]?.version, '4');
		assert.equal(frozen[key]?.name, HARNESS_LANGFUSE_PROMPT_NAMES[key]);
	}
	assert.equal(frozen.xhsViralRewrite, undefined);
	assert.equal(frozen.xhsViralImageVision, undefined);

	// Full resolve still demands pins for every key in strict mode.
	await assert.rejects(resolver.resolve(), /xhsViralRewrite|briefImage|xhsCoverPrompt/u);
});

test('release publish rejects missing pin and names the key (no builtin green path)', () => {
	const packBindings = defaultPromptPackBindings();
	const promptBindings = Object.fromEntries(
		promptKeysForAllPacks()
			.filter((key) => key !== 'xhsNoteGen')
			.map((key) => [key, promptRevisionRefSchema.parse({ key, version: '12' })]),
	);

	const result = validateReleasePromptPublish({
		promptPackBindings: packBindings,
		promptBindings,
	});
	assert.equal(result.ok, false);
	if (result.ok) throw new Error('expected failure');
	assert.ok(
		result.failures.some(
			(failure) =>
				failure.code === 'missing_prompt_binding' && failure.key === 'xhsNoteGen',
		),
		JSON.stringify(result.failures),
	);
	assert.match(
		result.failures.map((failure) => failure.message).join('\n'),
		/xhsNoteGen/u,
	);

	// Builtin version is never a valid publish pin.
	const withBuiltin = {
		...promptBindings,
		xhsNoteGen: { key: 'xhsNoteGen', version: 'builtin-v1' },
	};
	const builtinResult = validateReleasePromptPublish({
		promptPackBindings: packBindings,
		promptBindings: withBuiltin,
	});
	assert.equal(builtinResult.ok, false);
	if (builtinResult.ok) throw new Error('expected failure');
	assert.ok(
		builtinResult.failures.some(
			(failure) => failure.code === 'builtin_or_fallback_version',
		),
	);
});

test('release publish accepts complete exact pins for all packs', () => {
	const packBindings = defaultPromptPackBindings();
	const promptBindings = Object.fromEntries(
		promptKeysForAllPacks().map((key) => [
			key,
			promptRevisionRefSchema.parse({ key, version: String(3) }),
		]),
	);
	const result = validateReleasePromptPublish({
		promptPackBindings: packBindings,
		promptBindings,
	});
	if (!result.ok) {
		throw new Error(result.failures.map((failure) => failure.message).join('; '));
	}
	assert.equal(result.requiredKeys.length, HARNESS_PROMPT_SITE_COUNT);
});

test('boot production-release check is no-op without release and fails closed when unresolvable', () => {
	assert.doesNotThrow(() =>
		assertProductionReleasePromptResolvable({ productionRelease: null }),
	);
	assert.doesNotThrow(() =>
		assertProductionReleasePromptResolvable({ productionRelease: undefined }),
	);

	assert.throws(
		() =>
			assertProductionReleasePromptResolvable({
				productionRelease: {
					promptPackBindings: defaultPromptPackBindings(),
					promptBindings: {
						copyGeneration: { key: 'copyGeneration', version: '1' },
					},
				},
			}),
		/missing pinned prompt|not resolvable/u,
	);

	const complete = Object.fromEntries(
		promptKeysForAllPacks().map((key) => [
			key,
			{ key, version: '9' },
		]),
	);
	assert.doesNotThrow(() =>
		assertProductionReleasePromptResolvable({
			productionRelease: {
				promptPackBindings: defaultPromptPackBindings(),
				promptBindings: complete,
			},
		}),
	);
});

test('D-165 three axes stay flat top-level keys under pack freeze (A14)', () => {
	const frozen = {
		copyGeneration: {
			name: 'harness/copy-generation',
			version: '4',
			content: 'body',
			contentHash: 'a'.repeat(64),
			label: 'production',
			source: 'langfuse' as const,
			isFallback: false,
		},
		xhsViralRewrite: {
			name: 'harness/xhs-viral-rewrite',
			version: '2',
			content: 'body',
			contentHash: 'b'.repeat(64),
			label: 'production',
			source: 'langfuse' as const,
			isFallback: false,
		},
	};

	const promptAxes = flatPromptVersionAxes(frozen);
	// Flat map keyed by prompt key — never nested under pack ids.
	assert.deepEqual(promptAxes, {
		copyGeneration: 'harness/copy-generation@4',
		xhsViralRewrite: 'harness/xhs-viral-rewrite@2',
	});
	assert.equal('copy' in promptAxes, false);
	assert.equal('viral' in promptAxes, false);

	// Observability axes remain three flat top-level composite fields.
	const axes = observabilityAxesSchema.parse({
		skillRevision: 'copywriter@rev-1',
		promptVersion: promptAxes.copyGeneration,
		catalogRevision: 'catalog-2026-08-08',
		scene: 'copy.generate',
	});
	assert.equal(axes.promptVersion, 'harness/copy-generation@4');
	assert.equal(
		observabilityAxesSchema.safeParse({
			skillRevision: 'copywriter@rev-1',
			promptVersion: {
				packs: { copy: { copyGeneration: 'harness/copy-generation@4' } },
			},
			catalogRevision: 'catalog-2026-08-08',
			scene: 'copy.generate',
		}).success,
		false,
	);
	assert.equal(
		observabilityAxesSchema.safeParse({
			skillRevision: { pack: 'copy', revision: 'copywriter@rev-1' },
			promptVersion: 'harness/copy-generation@4',
			catalogRevision: 'catalog-2026-08-08',
			scene: 'copy.generate',
		}).success,
		false,
	);

	// Release artifact bindings are also flat Record<key, ref>, not nested packs.
	const bindings = defaultPromptPackBindings();
	assert.equal(typeof bindings.copy, 'object');
	assert.ok(Array.isArray(bindings.copy));
	// promptBindings shape for publish is flat key → ref (not pack → key → ref).
	const promptBindings = Object.fromEntries(
		promptKeysForPacks(['copy']).map((key) => [key, { key, version: '1' }]),
	);
	assert.equal('copyGeneration' in promptBindings, true);
	assert.equal(
		promptBindings.copyGeneration && 'version' in promptBindings.copyGeneration,
		true,
	);
});

test('isFallback selective freeze still produces audit-chain signals', async () => {
	const warnings: Array<{ name: string; reason: string }> = [];
	const resolver = new LangfuseHarnessPromptResolver({
		policy: 'pilot',
		warn: (warning) => warnings.push(warning),
	});
	const keys = promptKeysForPacks(['copy']);
	const frozen = await resolver.resolveKeys(keys);
	assert.equal(Object.keys(frozen).length, keys.length);
	assert.ok(Object.values(frozen).every((prompt) => prompt?.isFallback === true));

	const signals = collectPromptFallbackAuditSignals(frozen);
	assert.equal(signals.length, keys.length);
	assert.ok(signals.every((signal) => signal.isFallback === true));
	assert.ok(signals.every((signal) => signal.fallbackReason === 'unconfigured'));
	assert.ok(signals.some((signal) => signal.promptKey === 'copyGeneration'));
	// Downstream audit ports already persist this shape (task-admission);
	// pack freeze must not strip the signal.
	assert.ok(warnings.length >= keys.length);
});

function sendJson(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { 'content-type': 'application/json' });
	response.end(JSON.stringify(body));
}

async function listen(
	t: test.TestContext,
	server: ReturnType<typeof createServer>,
) {
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(
		() =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	);
	const { port } = server.address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
}
