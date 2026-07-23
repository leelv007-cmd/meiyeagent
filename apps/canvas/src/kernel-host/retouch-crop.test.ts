import assert from "node:assert/strict";
import test from "node:test";
import {
	cropDisplayAspectRatio,
	type RetouchCropHandle,
	resizeRetouchCrop,
} from "./retouch-crop.js";

const box = { height: 540, width: 960 };
const crop = { height: 0.2, width: 0.4, x: 0.2, y: 0.2 };
const aspect = cropDisplayAspectRatio(crop, box);

test("locked crop keeps a non-square displayed ratio for all eight resize handles", () => {
	const deltas: Record<RetouchCropHandle, { dx: number; dy: number }> = {
		e: { dx: 0.12, dy: 0 },
		n: { dx: 0, dy: -0.08 },
		ne: { dx: 0.12, dy: -0.08 },
		nw: { dx: -0.12, dy: -0.08 },
		s: { dx: 0, dy: 0.08 },
		se: { dx: 0.12, dy: 0.08 },
		sw: { dx: -0.12, dy: 0.08 },
		w: { dx: -0.12, dy: 0 },
	};

	for (const [handle, delta] of Object.entries(deltas) as Array<
		[RetouchCropHandle, { dx: number; dy: number }]
	>) {
		const next = resizeRetouchCrop({
			aspectRatio: aspect,
			box,
			crop,
			handle,
			...delta,
		});
		assert.ok(Math.abs(cropDisplayAspectRatio(next, box) - aspect) < 1e-9);
		assert.ok(next.x >= 0 && next.y >= 0, handle);
		assert.ok(next.x + next.width <= 1 && next.y + next.height <= 1, handle);
	}
});

test("locked crop clamps against the dragged edges without changing its display ratio", () => {
	const nearEdge = { height: 0.16, width: 0.28, x: 0.68, y: 0.74 };
	const nearEdgeAspect = cropDisplayAspectRatio(nearEdge, box);
	const next = resizeRetouchCrop({
		aspectRatio: nearEdgeAspect,
		box,
		crop: nearEdge,
		dx: 0.8,
		dy: 0.8,
		handle: "se",
	});

	assert.ok(
		Math.abs(cropDisplayAspectRatio(next, box) - nearEdgeAspect) < 1e-9,
	);
	assert.ok(next.x + next.width <= 1);
	assert.ok(next.y + next.height <= 1);
});
