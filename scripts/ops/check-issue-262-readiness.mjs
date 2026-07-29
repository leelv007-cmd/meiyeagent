#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const fetchRemote = args.has("--fetch");
const repository =
	process.env.ISSUE_262_GITHUB_REPOSITORY ??
	"leelv007-cmd/meiyeweb-agent";
const remote = process.env.ISSUE_262_REMOTE ?? "origin";
const branch = process.env.ISSUE_262_MAIN_BRANCH ?? "main";
const baseRef = process.env.ISSUE_262_BASE_REF ?? branch;

const gates = [
	{
		issue: 246,
		name: "prompt supply and fallback audit",
		requiredFor: "implementation",
		codeMarkers: ["promptRevisionRefs", "fallbackReason"],
	},
	{
		issue: 252,
		name: "capability vocabulary and matching axes",
		requiredFor: "implementation",
		codeMarkers: ["cjk-text-render"],
	},
	{
		issue: 248,
		name: "flat three-axis event contract",
		requiredFor: "closure",
		codeMarkers: ["skillRevision:", "promptVersion", "catalogRevision"],
	},
];

try {
	if (fetchRemote) {
		run("git", ["fetch", "--quiet", remote, branch]);
	}
	run("git", ["rev-parse", "--verify", `${baseRef}^{commit}`]);
	const baseSha = run("git", ["rev-parse", baseRef]).stdout.trim();
	const results = gates.map((gate) => inspectGate(gate));
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

function inspectGate(gate) {
	const issue = JSON.parse(
		run("gh", [
			"issue",
			"view",
			String(gate.issue),
			"--repo",
			repository,
			"--json",
			"state,comments,url",
		]).stdout,
	);
	const commentBodies = issue.comments.map((comment) => comment.body).join("\n");
	const mergedCommit = findMergedCommit(commentBodies);
	const hasTestCommand =
		/\b(?:pnpm|npm|node|tsx|vitest|playwright|test|typecheck)\b/iu.test(
			commentBodies,
		);
	const hasPassingExit =
		/\b(?:exit(?: code)?\s*[:=]?\s*0|pass(?:ed)?|green)\b|退出码\s*[:=]?\s*0|通过|全绿/iu.test(
			commentBodies,
		);
	const missingCodeMarkers = gate.codeMarkers.filter(
		(marker) => !refContains(marker),
	);
	const missing = [];
	if (!mergedCommit) {
		missing.push(`issue #${gate.issue} has no commented commit on ${baseRef}`);
	}
	if (!hasTestCommand || !hasPassingExit) {
		missing.push(`issue #${gate.issue} lacks a commented test command and pass result`);
	}
	if (missingCodeMarkers.length > 0) {
		missing.push(
			`${baseRef} lacks code markers: ${missingCodeMarkers.join(", ")}`,
		);
	}
	return {
		issue: gate.issue,
		name: gate.name,
		requiredFor: gate.requiredFor,
		state: issue.state,
		url: issue.url,
		mergedCommit,
		missing,
		ready: missing.length === 0,
	};
}

function findMergedCommit(text) {
	const candidates = [
		...new Set(text.match(/\b[0-9a-f]{7,40}\b/giu) ?? []),
	];
	for (const candidate of candidates) {
		const resolved = run(
			"git",
			["rev-parse", "--verify", `${candidate}^{commit}`],
			{ acceptedExitCodes: [0, 128] },
		);
		if (resolved.status !== 0) continue;
		const sha = resolved.stdout.trim();
		const ancestor = run(
			"git",
			["merge-base", "--is-ancestor", sha, baseRef],
			{ acceptedExitCodes: [0, 1] },
		);
		if (ancestor.status === 0) return sha;
	}
	return null;
}

function refContains(marker) {
	const result = run(
		"git",
		["grep", "--quiet", "--fixed-strings", marker, baseRef, "--", "apps", "packages"],
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
