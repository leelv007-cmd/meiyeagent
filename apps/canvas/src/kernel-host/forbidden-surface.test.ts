import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assertNoLocalAgentBridge } from "./agent-adapter";

function walk(dir: string, files: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, files);
		else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.includes(".test.")) {
			files.push(path);
		}
	}
	return files;
}

test("kernel-host source has no local agent bridge patterns", () => {
	const root = join(process.cwd(), "src/kernel-host");
	for (const file of walk(root)) {
		// Guard module itself documents forbidden tokens; skip self-scan.
		if (file.endsWith("agent-adapter.ts")) continue;
		const source = readFileSync(file, "utf8");
		assert.doesNotThrow(
			() => assertNoLocalAgentBridge(source),
			`unsafe pattern in ${file}`,
		);
	}
});

test("kernel-host never imports vendor local agent panel", () => {
	const root = join(process.cwd(), "src/kernel-host");
	for (const file of walk(root)) {
		const source = readFileSync(file, "utf8");
		assert.equal(source.includes("canvas-local-agent-panel"), false, file);
	}
});
