/**
 * The HeroUI Pro V3 mirror is licensed to this user alone: it may be read
 * locally, but never committed and never redistributed (D-130). Component
 * sources are vendored into the app by
 * mkfast-template-main/scripts/sync-heroui-pro.ts; the mirror itself must stay
 * out of git entirely.
 *
 * This guard fails the build if the ignore rule is dropped or if any file under
 * the mirror path reaches the index — including via `git add -f`, which
 * .gitignore alone would not stop.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIRROR_PATH = "references/repos/herouipro-v3";

export function checkHerouiMirror({ ignoredPaths, trackedPaths }) {
  const errors = [];

  const probes = [
    `${MIRROR_PATH}/`,
    `${MIRROR_PATH}/package.json`,
    `${MIRROR_PATH}/src/components/sidebar/sidebar.tsx`,
  ];
  for (const probe of probes) {
    if (!ignoredPaths.includes(probe)) {
      errors.push(
        `${probe} is not gitignored — the licensed HeroUI Pro mirror must never be committable`,
      );
    }
  }

  for (const tracked of trackedPaths) {
    errors.push(`${tracked} is tracked by git — remove it from the index`);
  }

  return errors;
}

/** `git check-ignore` exits 1 when nothing matched, which is not an error here. */
function gitCheckIgnore(rootDir, probes) {
  try {
    return execFileSync("git", ["check-ignore", "--", ...probes], {
      cwd: rootDir,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const rootDir =
    rootFlag === -1
      ? process.cwd()
      : path.resolve(process.cwd(), argv[rootFlag + 1]);

  const gitignore = await readFile(path.resolve(rootDir, ".gitignore"), "utf8");
  const probes = [
    `${MIRROR_PATH}/`,
    `${MIRROR_PATH}/package.json`,
    `${MIRROR_PATH}/src/components/sidebar/sidebar.tsx`,
  ];
  const errors = checkHerouiMirror({
    ignoredPaths: gitCheckIgnore(rootDir, probes),
    trackedPaths: execFileSync("git", ["ls-files", "--", MIRROR_PATH], {
      cwd: rootDir,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean),
  });

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const rule = gitignore
    .split("\n")
    .find((line) => line.trim() === `${MIRROR_PATH}/`);
  console.log(
    `HeroUI mirror guard passed: ${MIRROR_PATH} ignored by ".gitignore" rule "${rule}", 0 files tracked.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
