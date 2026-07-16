import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateDecisionTicketMap } from "./decision-ticket-guard.mjs";

const clone = (value) => structuredClone(value);

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "decision-ticket-guard-"));
  await mkdir(path.join(rootDir, "docs/adr"), { recursive: true });
  await mkdir(path.join(rootDir, ".scratch/uiux-upgrade-b/tickets"), {
    recursive: true,
  });
  await writeFile(
    path.join(rootDir, "docs/adr/0010.md"),
    "# ADR 0010\n\nToken streaming\nD4 single selection\n",
  );
  for (const ticket of ["01", "02", "06", "07", "08", "18", "22"]) {
    await writeFile(
      path.join(
        rootDir,
        `.scratch/uiux-upgrade-b/tickets/${ticket}-ticket.md`,
      ),
      `# Ticket ${ticket}\n\n<!-- decision-ticket-map:start -->\n\`\`\`json\n${JSON.stringify(
        {
          ticketId: ticket,
          decisionIds: ticket === "22" ? [] : ["DEC-STREAM"],
          guardrailDecisionIds: ticket === "22" ? ["DEC-L1"] : [],
          gapIds:
            ticket === "06" || ticket === "07" || ticket === "08"
              ? ["P0-1"]
              : [],
          contractIds: ["02", "06", "07", "08"].includes(ticket)
            ? ["I03"]
            : [],
          blockedBy: [],
          status: "open",
        },
        null,
        2,
      )}\n\`\`\`\n<!-- decision-ticket-map:end -->\n`,
    );
  }
  return rootDir;
}

function createManifest() {
  return {
    version: 1,
    invariants: {
      streaming: { mode: "token", ticketIds: ["06", "07", "08"] },
      d4: {
        selection: "single",
        candidateCount: 3,
        maxFreeRetries: 2,
        ticketIds: ["18"],
      },
      l1LinkCapture: { status: "de_scoped" },
      mediaModelSelection: { explicit: true, crossBrandAuto: false },
    },
    decisions: [
      {
        id: "DEC-STREAM",
        source: {
          path: "docs/adr/0010.md",
          contains: "Token streaming",
        },
        status: "active",
        userVisibleContract: "Text appears token by token.",
        gapIds: ["P0-1"],
        ticketIds: ["01", "02", "06", "07", "08", "18"],
        evidencePair: "current-vs-benchmark",
      },
      {
        id: "DEC-L1",
        source: {
          path: "docs/adr/0010.md",
          contains: "D4 single selection",
        },
        status: "de_scoped",
        userVisibleContract: "Link capture stays unavailable.",
        gapIds: [],
        ticketIds: [],
        evidencePair: "current-vs-benchmark",
      },
    ],
    gaps: [{ id: "P0-1", ticketIds: ["06", "07", "08"] }],
    contracts: [
      {
        id: "I03",
        level: "required",
        gapIds: ["P0-1"],
        ticketIds: ["02", "06", "07", "08"],
      },
    ],
    tickets: [
      {
        id: "01",
        file: ".scratch/uiux-upgrade-b/tickets/01-ticket.md",
        decisionIds: ["DEC-STREAM"],
        gapIds: [],
        contractIds: [],
        blockedBy: [],
        status: "open",
      },
      {
        id: "02",
        file: ".scratch/uiux-upgrade-b/tickets/02-ticket.md",
        decisionIds: ["DEC-STREAM"],
        gapIds: [],
        contractIds: ["I03"],
        blockedBy: [],
        status: "open",
      },
      ...["06", "07", "08"].map((id) => ({
        id,
        file: `.scratch/uiux-upgrade-b/tickets/${id}-ticket.md`,
        decisionIds: ["DEC-STREAM"],
        gapIds: ["P0-1"],
        contractIds: ["I03"],
        blockedBy: [],
        status: "open",
      })),
      {
        id: "18",
        file: ".scratch/uiux-upgrade-b/tickets/18-ticket.md",
        decisionIds: ["DEC-STREAM"],
        gapIds: [],
        contractIds: [],
        blockedBy: [],
        status: "open",
      },
      {
        id: "22",
        file: ".scratch/uiux-upgrade-b/tickets/22-ticket.md",
        decisionIds: [],
        guardrailDecisionIds: ["DEC-L1"],
        gapIds: [],
        contractIds: [],
        blockedBy: [],
        status: "open",
      },
    ],
  };
}

async function validate(mutator = () => {}) {
  const rootDir = await createFixtureRoot();
  const manifest = createManifest();
  mutator(manifest);
  return validateDecisionTicketMap({ manifest, rootDir });
}

test("accepts a complete decision-to-ticket graph", async () => {
  assert.deepEqual(await validate(), []);
});

test("rejects a missing P0-1 mapping", async () => {
  const errors = await validate((manifest) => {
    manifest.gaps = manifest.gaps.filter((gap) => gap.id !== "P0-1");
  });
  assert.ok(errors.some((error) => error.includes("P0-1")));
});

test("rejects reopening D4 as multi-select", async () => {
  const errors = await validate((manifest) => {
    manifest.invariants.d4.selection = "multiple";
  });
  assert.ok(errors.some((error) => error.includes("D4")));
});

test("rejects reviving de-scoped L-1 link capture", async () => {
  const errors = await validate((manifest) => {
    manifest.invariants.l1LinkCapture.status = "active";
  });
  assert.ok(errors.some((error) => error.includes("L-1")));
});

test("rejects cross-brand automatic media model selection", async () => {
  const errors = await validate((manifest) => {
    manifest.invariants.mediaModelSelection.crossBrandAuto = true;
  });
  assert.ok(errors.some((error) => error.includes("cross-brand Auto")));
});

test("rejects closing any ticket before ticket 02 is complete", async () => {
  const errors = await validate((manifest) => {
    manifest.tickets.find((ticket) => ticket.id === "06").status = "closed";
  });
  assert.ok(errors.some((error) => error.includes("ticket 02")));
});

test("honors a manifest-defined gate ticket id", async () => {
  const errors = await validate((manifest) => {
    manifest.gateTicketId = "01";
    const ticket06 = manifest.tickets.find((ticket) => ticket.id === "06");
    ticket06.status = "closed";
    ticket06.closureEvidence = ["docs/adr/0010.md"];
    ticket06.resolution = "completed";
  });
  assert.ok(errors.some((error) => error.includes("ticket 01 must be complete")));
  assert.ok(!errors.some((error) => error.includes("ticket 02 must be complete")));
});

test("rejects a closure-resolution drift", async () => {
  const errors = await validate((manifest) => {
    manifest.tickets.find((ticket) => ticket.id === "06").resolution = "superseded";
  });
  assert.ok(errors.some((error) => error.includes("closure resolution")));
});

test("rejects a missing decision source", async () => {
  const errors = await validate((manifest) => {
    manifest.decisions[0].source.path = "docs/adr/missing.md";
  });
  assert.ok(errors.some((error) => error.includes("missing.md")));
});

test("rejects ticket/manifest drift and dependency cycles", async () => {
  const errors = await validate((manifest) => {
    const ticket06 = manifest.tickets.find((ticket) => ticket.id === "06");
    const ticket07 = manifest.tickets.find((ticket) => ticket.id === "07");
    ticket06.blockedBy = ["07"];
    ticket07.blockedBy = ["06"];
    ticket06.decisionIds = [];
  });
  assert.ok(errors.some((error) => error.includes("ticket metadata")));
  assert.ok(errors.some((error) => error.includes("dependency cycle")));
});
