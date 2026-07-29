#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const fetchRemote = args.has("--fetch");
const repository =
	process.env.ISSUE_262_GITHUB_REPOSITORY ??
	"leelv007-cmd/meiyeweb-agent";
const controllerLogin =
	process.env.ISSUE_262_CONTROLLER_LOGIN ?? repository.split("/")[0];
const remote = process.env.ISSUE_262_REMOTE ?? "origin";
const branch = process.env.ISSUE_262_MAIN_BRANCH ?? "main";
const baseRef = process.env.ISSUE_262_BASE_REF ?? branch;

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
	const targetIssue = readIssue(262);
	const results = gates.map((gate) => inspectGate(gate, targetIssue.comments));
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

function readIssue(issueNumber) {
	return JSON.parse(
		runWithRetry("gh", [
			"issue",
			"view",
			String(issueNumber),
			"--repo",
			repository,
			"--json",
			"state,comments,url",
		]).stdout,
	);
}

function inspectGate(gate, targetComments) {
	const issue = readIssue(gate.issue);
	const controllerMergeCommit = findControllerMergeCommit(
		issue.comments,
		targetComments,
		gate.issue,
	);
	const missingSemanticEvidence = gate.semanticEvidence.filter(
		(evidence) => !refContains(evidence),
	);
	const missing = [];
	if (!controllerMergeCommit) {
		missing.push(
			`issue #${gate.issue} has no valid controller merge record on ${baseRef}`,
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
		state: issue.state,
		url: issue.url,
		controllerMergeCommit,
		missing,
		ready: missing.length === 0,
	};
}

function findControllerMergeCommit(issueComments, targetComments, issueNumber) {
	const records = [];
	for (const [index, comment] of issueComments.entries()) {
		const normalizedBody = normalizeControllerRecordBody(comment.body);
		const candidate = normalizedBody.match(
			/已合入\s+main@([0-9a-f]{7,40})\b/iu,
		)?.[1];
		if (
			comment.author?.login === controllerLogin &&
			comment.authorAssociation === "OWNER" &&
			normalizedBody.startsWith("主控亲验记录") &&
			(candidate || explicitlyNotMerged(normalizedBody))
		) {
			records.push({
				candidate,
				comment,
				index,
			});
		}
	}
	for (const [index, comment] of targetComments.entries()) {
		const normalizedBody = normalizeControllerRecordBody(comment.body);
		const issueSegment = ticketSegment(normalizedBody, issueNumber);
		const candidate = issueSegment?.match(/\b([0-9a-f]{7,40})\b/iu)?.[1];
		if (
			comment.author?.login === controllerLogin &&
			comment.authorAssociation === "OWNER" &&
			isControllerDirective(normalizedBody) &&
			issueSegment &&
			(candidate || explicitlyNotMerged(issueSegment))
		) {
			records.push({
				candidate,
				comment,
				index: issueComments.length + index,
			});
		}
	}
	const record = records.toSorted(compareControllerRecords).at(-1);
	if (!record) return null;
	const candidate = record.candidate;
	if (!candidate) return null;
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
	return ancestor.status === 0 ? sha : null;
}

function compareControllerRecords(left, right) {
	const leftTime = Date.parse(left.comment.createdAt ?? "");
	const rightTime = Date.parse(right.comment.createdAt ?? "");
	if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
		return leftTime - rightTime;
	}
	return left.index - right.index;
}

function ticketSegment(body, issueNumber) {
	const match = body.match(
		new RegExp(
			`#${issueNumber}\\b((?:(?!#\\d+)[\\s\\S]){0,240})`,
			"iu",
		),
	);
	return match?.[1] ?? null;
}

function explicitlyNotMerged(body) {
	return /(?:尚未合入|未合入|尚未进入|未进入|尚未落入|未落入|未入)\s*main/iu.test(
		body,
	);
}

function isControllerDirective(body) {
	return [
		"主控亲验记录",
		"依赖更新（v4 编排）",
		"主控合同增补",
		"主控裁决",
	].some((prefix) => body.startsWith(prefix));
}

function normalizeControllerRecordBody(body) {
	const trimmed = body.trimStart();
	return trimmed.startsWith("**主控亲验记录") ? trimmed.slice(2) : trimmed;
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

function runWithRetry(command, commandArgs, attempts = 3) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return run(command, commandArgs);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
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
