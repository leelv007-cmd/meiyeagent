import assert from "node:assert/strict";
import test from "node:test";
import {
	defaultImageQuickToolIds,
	IMAGE_QUICK_TOOL_CATALOG,
	normalizeImageQuickToolIds,
	parseImageQuickToolsStorage,
	readImageQuickToolsConfig,
	serializeImageQuickToolsConfig,
} from "./image-quick-tools.js";

test("normalizeImageQuickToolIds keeps catalog order and drops unknown/K3 ids", () => {
	assert.deepEqual(
		normalizeImageQuickToolIds([
			"view",
			"maskEdit",
			"info",
			"upscale",
			"delete",
			"not-a-tool",
		]),
		["info", "delete", "view"],
	);
});

test("readImageQuickToolsConfig accepts legacy array form and object form", () => {
	assert.deepEqual(readImageQuickToolsConfig(["download", "info"]), {
		ids: ["info", "download"],
		showLabels: true,
	});
	assert.deepEqual(
		readImageQuickToolsConfig({
			ids: ["crop", "resize"],
			showLabels: false,
		}),
		{ ids: ["resize", "crop"], showLabels: false },
	);
});

test("empty selection falls back to defaults so the toolbar never vanishes", () => {
	assert.deepEqual(readImageQuickToolsConfig({ ids: [], showLabels: true }), {
		ids: [...defaultImageQuickToolIds],
		showLabels: true,
	});
	assert.deepEqual(readImageQuickToolsConfig(null), {
		ids: [...defaultImageQuickToolIds],
		showLabels: true,
	});
});

test("parse and serialize round-trip localStorage payloads", () => {
	const serialized = serializeImageQuickToolsConfig({
		ids: ["info", "delete", "view"],
		showLabels: false,
	});
	assert.deepEqual(parseImageQuickToolsStorage(serialized), {
		ids: ["info", "delete", "view"],
		showLabels: false,
	});
	assert.deepEqual(parseImageQuickToolsStorage("not-json{"), {
		ids: [...defaultImageQuickToolIds],
		showLabels: true,
	});
	assert.deepEqual(parseImageQuickToolsStorage(null), {
		ids: [...defaultImageQuickToolIds],
		showLabels: true,
	});
});

test("default catalog is the full merchant-safe set", () => {
	assert.deepEqual(defaultImageQuickToolIds, [...IMAGE_QUICK_TOOL_CATALOG]);
});
