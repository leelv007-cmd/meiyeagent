#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const fetchRemote = args.has("--fetch");
const remote = process.env.ISSUE_262_REMOTE ?? "origin";
const branch = process.env.ISSUE_262_MAIN_BRANCH ?? "main";
const baseRef = process.env.ISSUE_262_BASE_REF ?? branch;
const mergeLedgerPath = "docs/ops/merge-ledger.md";

const gates = [
	{
		issue: 246,
		name: "prompt supply and fallback audit",
		requiredFor: "implementation",
		semanticEvidence: [
			{
				path: "apps/core/src/p1/harness/langfuse-prompts.ts",
				marker: "export type LangfusePromptPolicy =",
			},
			{
				path: "apps/core/src/p1/harness/langfuse-prompts.ts",
				marker: "export function assertLangfusePromptRuntimePolicy(",
			},
			{
				path: "apps/core/src/p1/harness/task-admission.ts",
				marker: "export interface HarnessPromptFallbackAuditPort",
			},
			{
				path: "apps/core/src/p1/harness/task-admission.ts",
				marker: "eventType: 'langfuse_prompt_fallback';",
			},
		],
	},
	{
		issue: 247,
		name: "bounded execution task snapshot",
		requiredFor: "implementation",
		semanticEvidence: [
			{
				path: "packages/contracts/src/bounded-execution.ts",
				marker: "export const boundedExecutionSnapshotSchema =",
			},
			{
				path: "packages/contracts/src/bounded-execution.ts",
				marker: "export const boundedExecutionEventSchema =",
			},
			{
				path: "apps/core/src/p1/harness/task-admission.ts",
				marker: "export interface HarnessExecutionBoundsResolver",
			},
			{
				path: "apps/core/src/p1/harness/task-admission.ts",
				marker: "readonly code = 'REQUIRED_EXECUTION_LIMIT_UNSET';",
			},
		],
	},
	{
		issue: 248,
		name: "flat three-axis event contract",
		requiredFor: "closure",
		semanticEvidence: [
			{
				path: "packages/contracts/src/observability.ts",
				marker: "export const observabilityAxesSchema =",
			},
			{
				path: "packages/contracts/src/observability.ts",
				marker: "skillRevision: compositeRevisionSchema,",
			},
			{
				path: "packages/contracts/src/observability.ts",
				marker: "promptVersion: compositeRevisionSchema,",
			},
			{
				path: "packages/contracts/src/observability.ts",
				marker: "catalogRevision: z.string().trim().min(1),",
			},
		],
	},
];

try {
	if (fetchRemote) {
		run("git", ["fetch", "--quiet", remote, branch]);
	}
	run("git", ["rev-parse", "--verify", `${baseRef}^{commit}`]);
	const baseSha = run("git", ["rev-parse", baseRef]).stdout.trim();
	const mergeLedger = readMergeLedger();
	const results = gates.map((gate) => inspectGate(gate, mergeLedger));
	const implementationReady = results
		.filter((result) => result.requiredFor === "implementation")
		.every((result) => result.ready);
	const closureReady =
		implementationReady &&
		results
			.filter((result) => result.requiredFor === "closure")
			.every((result) => result.ready);
	const report = {
		baseRef,
		baseSha,
		checkedAt: new Date().toISOString(),
		implementationReady,
		closureReady,
		gates: results,
	};

	if (jsonOutput) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		printReport(report);
	}
	process.exitCode = implementationReady ? 0 : 3;
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	if (jsonOutput) {
		console.log(
			JSON.stringify(
				{
					checkedAt: new Date().toISOString(),
					error: message,
				},
				null,
				2,
			),
		);
	} else {
		console.error(`Issue 262 readiness check failed: ${message}`);
	}
	process.exitCode = 2;
}

function readMergeLedger() {
	return run("git", ["show", `${baseRef}:${mergeLedgerPath}`]).stdout;
}

function inspectGate(gate, mergeLedger) {
	const mergeLedgerCommit = findMergeLedgerCommit(mergeLedger, gate.issue);
	const missingSemanticEvidence = gate.semanticEvidence.filter(
		(evidence) => !refContains(evidence),
	);
	const missing = [];
	if (!mergeLedgerCommit) {
		missing.push(
			`issue #${gate.issue} has no valid ${mergeLedgerPath} entry on ${baseRef}`,
		);
	}
	if (missingSemanticEvidence.length > 0) {
		missing.push(
			`${baseRef} lacks semantic evidence: ${missingSemanticEvidence
				.map((evidence) => `${evidence.path} contains ${evidence.marker}`)
				.join(", ")}`,
		);
	}
	return {
		issue: gate.issue,
		name: gate.name,
		requiredFor: gate.requiredFor,
		mergeLedgerCommit,
		missing,
		ready: missing.length === 0,
	};
}

function findMergeLedgerCommit(mergeLedger, issueNumber) {
	const row = mergeLedger
		.split(/\r?\n/u)
		.toReversed()
		.find((line) => {
			const cells = parseLedgerRow(line);
			return cells?.[1] === `#${issueNumber}`;
		});
	if (!row) return null;
	const cells = parseLedgerRow(row);
	const candidates = cells?.[0].match(/[0-9a-f]{7,40}/giu) ?? [];
	if (candidates.length === 0) return null;
	const resolvedCandidates = [];
	for (const candidate of candidates) {
		const resolved = run(
			"git",
			["rev-parse", "--verify", `${candidate}^{commit}`],
			{ acceptedExitCodes: [0, 128] },
		);
		if (resolved.status !== 0) return null;
		const sha = resolved.stdout.trim();
		const ancestor = run(
			"git",
			["merge-base", "--is-ancestor", sha, baseRef],
			{ acceptedExitCodes: [0, 1] },
		);
		if (ancestor.status !== 0) return null;
		resolvedCandidates.push(sha);
	}
	return resolvedCandidates.at(-1) ?? null;
}

function parseLedgerRow(line) {
	if (!line.startsWith("|") || !line.endsWith("|")) return null;
	return line
		.slice(1, -1)
		.split("|")
		.map((cell) => cell.trim());
}

function refContains(evidence) {
	const result = run(
		"git",
		[
			"grep",
			"--quiet",
			"--fixed-strings",
			evidence.marker,
			baseRef,
			"--",
			evidence.path,
		],
		{ acceptedExitCodes: [0, 1] },
	);
	return result.status === 0;
}

function printReport(report) {
	console.log(`Issue 262 readiness at ${report.baseRef} (${report.baseSha})`);
	for (const gate of report.gates) {
		const state = gate.ready ? "READY" : "WAIT";
		console.log(`- #${gate.issue} ${state}: ${gate.name}`);
		for (const reason of gate.missing) {
			console.log(`  - ${reason}`);
		}
	}
	console.log(
		`IMPLEMENTATION_READY=${report.implementationReady ? "yes" : "no"}`,
	);
	console.log(`CLOSURE_READY=${report.closureReady ? "yes" : "no"}`);
}

function run(command, commandArgs, options = {}) {
	const acceptedExitCodes = options.acceptedExitCodes ?? [0];
	const result = spawnSync(command, commandArgs, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.error) {
		throw new Error(`${command} failed to start: ${result.error.message}`);
	}
	if (!acceptedExitCodes.includes(result.status)) {
		const detail = result.stderr.trim() || result.stdout.trim();
		throw new Error(
			`${command} ${commandArgs.join(" ")} exited ${result.status}${
				detail ? `: ${detail}` : ""
			}`,
		);
	}
	return result;
}
