import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const scriptPath = join(
	repositoryRoot,
	"scripts/ops/check-issue-262-readiness.mjs",
);

test("comment-only merge claims cannot unlock issue 262", async () => {
	const fixture = await createFixtureRepository();
	const result = runGate(fixture);

	assert.equal(result.status, 3, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.implementationReady, false);
	assert.equal(report.closureReady, false);
	assert.equal(
		report.gates.find((gate) => gate.issue === 246)?.mergeLedgerCommit,
		null,
	);
});

test("merge-ledger entries unlock exact semantic products", async () => {
	const fixture = await createFixtureRepository({
		ledgerEntries: ["{sha}|#246", "{sha}|#247", "{sha}|#248"],
	});
	const result = runGate(fixture);

	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.deepEqual(
		report.gates.map((gate) => gate.issue),
		[246, 247, 248],
	);
	assert.equal(report.implementationReady, true);
	assert.equal(report.closureReady, true);
	assert.ok(report.gates.every((gate) => gate.mergeLedgerCommit));
});

test("a merge-ledger entry cannot replace missing semantic products", async () => {
	const fixture = await createFixtureRepository({
		include246Evidence: false,
		includeGeneric246Markers: true,
		ledgerEntries: ["{sha}|#246", "{sha}|#247", "{sha}|#248"],
	});
	const result = runGate(fixture);

	assert.equal(result.status, 3, result.stderr);
	const report = JSON.parse(result.stdout);
	const promptGate = report.gates.find((gate) => gate.issue === 246);
	assert.equal(promptGate.ready, false);
	assert.match(promptGate.missing.join("\n"), /lacks semantic evidence/);
	assert.equal(promptGate.mergeLedgerCommit, fixture.productSha);
});

test("the latest matching ledger row is authoritative and fail-closed", async () => {
	const fixture = await createFixtureRepository({
		ledgerEntries: [
			"{sha}|#246",
			"{sha}|#247",
			"{sha}|#248",
			"NOT_A_SHA|#246",
		],
	});
	const result = runGate(fixture);

	assert.equal(result.status, 3, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(
		report.gates.find((gate) => gate.issue === 246)?.mergeLedgerCommit,
		null,
	);
	assert.equal(report.implementationReady, false);
});

test("ledger ticket cells must match the exact upstream issue", async () => {
	const fixture = await createFixtureRepository({
		ledgerEntries: ["{sha}|#1246", "{sha}|#247", "{sha}|#248"],
	});
	const result = runGate(fixture);

	assert.equal(result.status, 3, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(
		report.gates.find((gate) => gate.issue === 246)?.mergeLedgerCommit,
		null,
	);
});

test("every SHA in a composite ledger receipt must be on main", async () => {
	const fixture = await createFixtureRepository({
		ledgerEntries: [
			"{sha}+deadbee|#246",
			"{sha}|#247",
			"{sha}|#248",
		],
	});
	const result = runGate(fixture);

	assert.equal(result.status, 3, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(
		report.gates.find((gate) => gate.issue === 246)?.mergeLedgerCommit,
		null,
	);
});

test("a missing merge ledger is a checker failure", async () => {
	const fixture = await createFixtureRepository({ includeLedger: false });
	const result = runGate(fixture);

	assert.equal(result.status, 2, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.match(report.error, /merge-ledger\.md/u);
});

async function createFixtureRepository(options = {}) {
	const {
		include246Evidence = true,
		includeGeneric246Markers = false,
		includeLedger = true,
		ledgerEntries = [],
	} = options;
	const directory = await mkdtemp(join(tmpdir(), "meiye-issue-262-gate-"));
	await mkdir(join(directory, "apps/core/src/p1/harness"), {
		recursive: true,
	});
	await mkdir(join(directory, "packages/contracts/src"), { recursive: true });
	await writeFile(
		join(directory, "apps/core/src/p1/harness/task-admission.ts"),
		[
			...(include246Evidence
				? [
						"export interface HarnessPromptFallbackAuditPort {",
						"  eventType: 'langfuse_prompt_fallback';",
						"}",
					]
				: []),
			"export interface HarnessExecutionBoundsResolver {}",
			"class HarnessExecutionBoundsAdmissionError {",
			"  readonly code = 'REQUIRED_EXECUTION_LIMIT_UNSET';",
			"}",
		].join("\n"),
	);
	if (include246Evidence) {
		await writeFile(
			join(directory, "apps/core/src/p1/harness/langfuse-prompts.ts"),
			[
				"export type LangfusePromptPolicy = 'pilot' | 'strict';",
				"export function assertLangfusePromptRuntimePolicy() {}",
			].join("\n"),
		);
	}
	if (includeGeneric246Markers) {
		await writeFile(
			join(directory, "apps/core/src/unrelated.ts"),
			[
				"export const promptRevisionRefs = {};",
				"export const fallbackReason = 'unrelated';",
			].join("\n"),
		);
	}
	await writeFile(
		join(directory, "packages/contracts/src/bounded-execution.ts"),
		[
			"export const boundedExecutionSnapshotSchema = {};",
			"export const boundedExecutionEventSchema = {};",
		].join("\n"),
	);
	await writeFile(
		join(directory, "packages/contracts/src/observability.ts"),
		[
			"export const observabilityAxesSchema = {",
			"  skillRevision: compositeRevisionSchema,",
			"  promptVersion: compositeRevisionSchema,",
			"  catalogRevision: z.string().trim().min(1),",
			"};",
		].join("\n"),
	);
	runGit(directory, ["init", "--initial-branch=main"]);
	runGit(directory, ["config", "user.email", "issue-262@example.test"]);
	runGit(directory, ["config", "user.name", "Issue 262 Test"]);
	runGit(directory, ["add", "."]);
	runGit(directory, ["commit", "-m", "test: seed readiness fixture"]);
	const productSha = runGit(directory, ["rev-parse", "main"]).stdout.trim();
	if (includeLedger) {
		await mkdir(join(directory, "docs/ops"), { recursive: true });
		await writeFile(
			join(directory, "docs/ops/merge-ledger.md"),
			[
				"# Merge ledger",
				"",
				"| main sha | ticket | content | evidence | notes |",
				"|---|---|---|---|---|",
				...ledgerEntries.map((entry) => {
					const [sha, ticket] = entry.replaceAll("{sha}", productSha).split("|");
					return `| ${sha} | ${ticket} | fixture | tests | |`;
				}),
			].join("\n"),
		);
		runGit(directory, ["add", "docs/ops/merge-ledger.md"]);
		runGit(directory, ["commit", "-m", "docs: record fixture merges"]);
	}
	const ghPath = join(directory, "gh");
	await writeFile(
		ghPath,
		`#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  state: "OPEN",
  url: "https://example.test/issues/262",
  comments: [{
    author: { login: "leelv007-cmd" },
    authorAssociation: "OWNER",
    body: "**主控亲验记录（fixture）：已合入 main@${productSha}。**"
  }]
}));
`,
	);
	await chmod(ghPath, 0o755);
	return { directory, productSha };
}

function runGate(fixture) {
	return spawnSync(process.execPath, [scriptPath, "--json"], {
		cwd: fixture.directory,
		encoding: "utf8",
		env: {
			...process.env,
			ISSUE_262_BASE_REF: "main",
			PATH: `${fixture.directory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
		},
	});
}

function runGit(cwd, args) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	return result;
}
