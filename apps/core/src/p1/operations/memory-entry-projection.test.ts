import assert from "node:assert/strict";
import test from "node:test";

import {
	type MemoryEntriesPage,
	type PreferenceCandidate,
	type PreferenceMemoryKind,
	requiredP1Capability,
} from "@meiye/contracts";

import type { P1Context } from "../foundation/domain.js";
import { MemoryFoundationModule } from "./memory-foundation-module.js";
import {
	MemoryReuseMemoryRepository,
	ReuseMemoryService,
} from "./reuse-memory-service.js";

const context: P1Context = {
	actor: "owner",
	correlationId: "memory-entry-projection",
	userId: "owner-a",
	workspaceId: "workspace-a",
};

const sourceVerifier = {
	async verifyCandidate() {},
	async verifyRevision() {},
};

function moduleAt(now: string) {
	const repository = new MemoryReuseMemoryRepository();
	const reuse = new ReuseMemoryService(repository, sourceVerifier, () => now);
	return {
		repository,
		reuse,
		module: new MemoryFoundationModule(reuse),
	};
}

async function entriesPage(
	module: MemoryFoundationModule,
	payload: { limit: number; cursor?: string },
) {
	return (await module.query({
		context,
		input: { action: "entries_page", payload },
	})) as MemoryEntriesPage;
}

async function propose(
	reuse: ReuseMemoryService,
	input: {
		candidateId: string;
		kind: PreferenceMemoryKind;
		proposedAt: string;
		proposedValue?: unknown;
		statement?: string;
		authority?: PreferenceCandidate["authority"];
		memoryState?: PreferenceCandidate["memoryState"];
		conversationId?: string;
	},
) {
	const conversationId =
		input.conversationId ?? `conversation-${input.candidateId}`;
	return reuse.proposePreference({
		candidateId: input.candidateId,
		workspaceId: context.workspaceId,
		semanticKey: `memory.${input.kind}.${input.candidateId}`,
		proposedValue: input.proposedValue ?? input.kind,
		defaultScope: { storeId: "store-a" },
		evidenceDecisionIds: [`decision-${input.candidateId}`],
		evidenceTaskIds: [`task-${input.candidateId}`],
		trigger: "explicit_long_term_intent",
		status: "pending",
		proposedAt: input.proposedAt,
		kind: input.kind,
		authority: input.authority ?? "observation",
		memoryState: input.memoryState ?? "proposed",
		statement: input.statement ?? `${input.kind} statement`,
		channel: "cross_thread",
		source: {
			conversationId,
			sourceTurnId: `turn-${input.candidateId}`,
			messageRange: { start: 0, end: 0 },
		},
	});
}

test("entries_page projects mixed preference/correction/procedure/episode with correction first", async () => {
	const { module, reuse } = moduleAt("2026-08-08T12:00:00.000Z");
	await propose(reuse, {
		candidateId: "entry-preference",
		kind: "preference",
		proposedAt: "2026-08-08T11:00:00.000Z",
		proposedValue: { tone: "warm" },
		statement: "语气要暖，不要硬广",
	});
	await propose(reuse, {
		candidateId: "entry-procedure",
		kind: "procedure",
		proposedAt: "2026-08-08T10:00:00.000Z",
		statement: "先出三图再补价格",
	});
	await propose(reuse, {
		candidateId: "entry-episode",
		kind: "episode",
		proposedAt: "2026-08-08T09:00:00.000Z",
		statement: "上次团购删掉了价格强调",
	});
	await propose(reuse, {
		candidateId: "entry-correction",
		kind: "correction",
		proposedAt: "2026-08-08T08:00:00.000Z",
		proposedValue: "小林不是老板娘",
		statement: "小林不是老板娘",
	});
	await reuse.confirmPreference(context, {
		candidateId: "entry-correction",
		preferenceId: "pref-correction",
		expectedRevision: 0,
		positiveExamples: [],
		negativeExamples: [],
		idempotencyKey: "confirm-correction",
	});

	const page = await entriesPage(module, { limit: 50 });
	assert.deepEqual(
		page.items.map((item) => item.kind),
		["correction", "preference", "procedure", "episode"],
	);
	assert.equal(page.items[0]?.entryId, "entry-correction");
	for (const item of page.items) {
		assert.equal(typeof item.kind, "string");
		assert.equal(typeof item.authority, "string");
		assert.equal(typeof item.state, "string");
		assert.equal(typeof item.revision, "number");
		assert.equal(typeof item.statement, "string");
		assert.ok(item.source);
		assert.equal(item.statement.includes("{"), false);
	}
	const correction = page.items[0];
	assert.equal(correction?.kind, "correction");
	assert.equal(correction?.authority, "confirmed");
	assert.equal(correction?.state, "active");
	assert.equal(correction?.revision, 1);
	assert.equal(correction?.statement, "小林不是老板娘");
	assert.equal(correction?.status, "confirmed");
	const preference = page.items.find((item) => item.kind === "preference");
	assert.equal(preference?.statement, "语气要暖，不要硬广");
	assert.deepEqual(preference?.value, { tone: "warm" });
	assert.equal(preference?.revision, 0);
	assert.equal(preference?.authority, "observation");
	assert.equal(preference?.state, "proposed");
});

test("source status deleted does not cascade-delete the memory row", async () => {
	const { module, reuse, repository } = moduleAt("2026-08-08T12:00:00.000Z");
	await repository.saveMemorySourceConversation({
		workspaceId: context.workspaceId,
		conversationId: "conversation-keep",
		turnId: "turn-keep",
		observedAt: "2026-08-08T11:00:00.000Z",
		messages: [{ index: 0, text: "以后都这样写。" }],
	});
	await propose(reuse, {
		candidateId: "entry-keep",
		kind: "preference",
		proposedAt: "2026-08-08T11:00:00.000Z",
		conversationId: "conversation-keep",
		statement: "以后都这样写",
	});
	await reuse.confirmPreference(context, {
		candidateId: "entry-keep",
		preferenceId: "pref-keep",
		expectedRevision: 0,
		positiveExamples: [],
		negativeExamples: [],
		idempotencyKey: "confirm-keep",
	});
	await reuse.markMemorySourceDeleted(context.workspaceId, "conversation-keep");

	const page = await entriesPage(module, { limit: 50 });
	assert.equal(page.items.length, 1);
	assert.equal(page.items[0]?.entryId, "entry-keep");
	assert.equal(page.items[0]?.status, "confirmed");
	assert.equal(page.items[0]?.source?.status, "deleted");
	assert.equal(page.items[0]?.kind, "preference");
	assert.equal(page.items[0]?.statement, "以后都这样写");
});

test("cursor can request a page that includes the 51st row", async () => {
	const { module, reuse } = moduleAt("2026-08-08T12:00:00.000Z");
	for (let index = 0; index < 51; index += 1) {
		const id = `row-${index.toString().padStart(2, "0")}`;
		await propose(reuse, {
			candidateId: id,
			kind: "preference",
			proposedAt: "2026-08-08T10:00:00.000Z",
			statement: id,
		});
	}
	const first = await entriesPage(module, { limit: 50 });
	assert.equal(first.items.length, 50);
	assert.ok(first.nextCursor);
	const second = await entriesPage(module, {
		limit: 50,
		cursor: first.nextCursor ?? undefined,
	});
	assert.equal(second.items.length, 1);
	assert.equal(second.nextCursor, null);
	const ids = new Set(
		[...first.items, ...second.items].map((item) => item.entryId),
	);
	assert.equal(ids.size, 51);
	assert.ok(second.items[0]?.entryId);
	assert.equal(
		first.items.some((item) => item.entryId === second.items[0]?.entryId),
		false,
	);
});

test("memory module has no merchant full-export query or command", async () => {
	const { module } = moduleAt("2026-08-08T12:00:00.000Z");
	await assert.rejects(
		module.query({
			context,
			input: { action: "entries_page", payload: { limit: 51 } },
		}),
		/Invalid memory payload/u,
	);
	await assert.rejects(
		module.query({
			context,
			input: { action: "entries_page", payload: { all: true } },
		}),
		/Invalid memory payload/u,
	);
	for (const action of [
		"export",
		"export_all",
		"full_export",
		"entries_export",
		"download",
	]) {
		await assert.rejects(
			module.query({ context, input: { action, payload: {} } }),
			/Unknown memory query/u,
		);
		assert.equal(requiredP1Capability("query", "memory", action), null);
		await assert.rejects(
			module.execute({
				context,
				idempotencyKey: `unknown-${action}`,
				input: { action, payload: {} },
			}),
			/Unknown memory command/u,
		);
		assert.equal(requiredP1Capability("command", "memory", action), null);
	}
});
