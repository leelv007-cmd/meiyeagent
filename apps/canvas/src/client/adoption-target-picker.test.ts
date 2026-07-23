import assert from "node:assert/strict";
import test from "node:test";
import {
	adoptionTargetQuery,
	appendAdoptionTargetPage,
	existingPackageAdoptionTarget,
} from "./adoption-target-picker.js";

const target = {
	handle: {
		baseVersionId: "version-current",
		expectedRevision: 7,
		packageId: "package-internal",
	},
	id: "package-internal",
	title: "夏日护理套餐",
};

test("adoption target queries preserve explicit search and cursor pagination", () => {
	assert.deepEqual(adoptionTargetQuery(" 夏日 "), { query: "夏日" });
	assert.deepEqual(adoptionTargetQuery("夏日", "cursor-2"), {
		cursor: "cursor-2",
		query: "夏日",
	});
	assert.deepEqual(adoptionTargetQuery("   "), {});
	assert.deepEqual(
		appendAdoptionTargetPage(
			[target],
			[
				{ ...target, title: "夏日护理套餐（已更新）" },
				{
					...target,
					handle: { ...target.handle, packageId: "package-next" },
					id: "package-next",
					title: "秋季护理套餐",
				},
			],
		),
		[
			{ ...target, title: "夏日护理套餐（已更新）" },
			{
				...target,
				handle: { ...target.handle, packageId: "package-next" },
				id: "package-next",
				title: "秋季护理套餐",
			},
		],
	);
});

test("existing-package adoption input is constructed only from the server target handle", () => {
	assert.deepEqual(existingPackageAdoptionTarget(target), {
		baseVersionId: "version-current",
		expectedRevision: 7,
		kind: "existing_package",
		packageId: "package-internal",
	});
});
