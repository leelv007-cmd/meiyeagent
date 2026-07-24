import assert from "node:assert/strict";
import test from "node:test";

import { checkHerouiMirror } from "./heroui-mirror-guard.mjs";

const ALL_IGNORED = [
  "references/repos/herouipro-v3/",
  "references/repos/herouipro-v3/package.json",
  "references/repos/herouipro-v3/src/components/sidebar/sidebar.tsx",
];

test("passes when the mirror is ignored and untracked", () => {
  assert.deepEqual(
    checkHerouiMirror({ ignoredPaths: ALL_IGNORED, trackedPaths: [] }),
    [],
  );
});

test("fails when the ignore rule is dropped", () => {
  const errors = checkHerouiMirror({ ignoredPaths: [], trackedPaths: [] });
  assert.equal(errors.length, ALL_IGNORED.length);
  assert.match(errors[0], /is not gitignored/);
});

test("fails when a file below the mirror is only ignored at the top level", () => {
  // A `references/repos/herouipro-v3` rule without the trailing slash stops
  // matching once the directory is absent, so probe files must be checked too.
  const errors = checkHerouiMirror({
    ignoredPaths: [ALL_IGNORED[0]],
    trackedPaths: [],
  });
  assert.equal(errors.length, 2);
});

test("fails when any mirror file reached the index", () => {
  const errors = checkHerouiMirror({
    ignoredPaths: ALL_IGNORED,
    trackedPaths: ["references/repos/herouipro-v3/LICENSE"],
  });
  assert.deepEqual(errors, [
    "references/repos/herouipro-v3/LICENSE is tracked by git — remove it from the index",
  ]);
});
