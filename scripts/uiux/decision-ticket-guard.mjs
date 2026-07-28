import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_DECISION_STATUSES = new Set([
  "active",
  "deferred",
  "de_scoped",
  "superseded",
]);
const ALLOWED_TICKET_STATUSES = new Set(["open", "closed"]);
const ALLOWED_TICKET_RESOLUTIONS = new Set(["completed", "superseded"]);
const TICKET_METADATA_PATTERN =
  /<!-- decision-ticket-map:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- decision-ticket-map:end -->/g;
const TRACKED_LEDGER_PATH_ALIASES = [
  [
    ".scratch/creatok-uiux-wayfinding/assets/",
    "docs/ledgers/uiux-upgrade-b/evidence/",
  ],
  [".scratch/uiux-upgrade-b/", "docs/ledgers/uiux-upgrade-b/"],
  [
    ".scratch/contentpackage-productization/",
    "docs/ledgers/contentpackage-productization/",
  ],
];

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sameStrings(left, right) {
  return (
    JSON.stringify([...array(left)].sort()) ===
    JSON.stringify([...array(right)].sort())
  );
}

function duplicateIds(items) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of array(items)) {
    if (!item || typeof item.id !== "string") continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates];
}

function resolveRepoPath(rootDir, relativePath, pathAliases) {
  const alias = pathAliases.find(([source]) => relativePath.startsWith(source));
  const resolvedPath = alias
    ? `${alias[1]}${relativePath.slice(alias[0].length)}`
    : relativePath;
  return path.resolve(rootDir, resolvedPath);
}

async function readTicketMetadata(rootDir, ticket, pathAliases) {
  const ticketPath = resolveRepoPath(rootDir, ticket.file, pathAliases);
  const contents = await readFile(ticketPath, "utf8");
  const matches = [...contents.matchAll(TICKET_METADATA_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(
      `${ticket.file} must contain exactly one decision-ticket-map block`,
    );
  }
  try {
    return JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(`${ticket.file} has invalid ticket metadata JSON: ${error.message}`);
  }
}

function findDependencyCycle(tickets) {
  const graph = new Map(
    tickets.map((ticket) => [ticket.id, array(ticket.blockedBy)]),
  );
  const visiting = new Set();
  const visited = new Set();

  function visit(id, trail) {
    if (visiting.has(id)) {
      const start = trail.indexOf(id);
      return [...trail.slice(start), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) {
      const cycle = visit(dependency, [...trail, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  for (const id of graph.keys()) {
    const cycle = visit(id, []);
    if (cycle) return cycle;
  }
  return null;
}

export async function validateDecisionTicketMap({
  manifest,
  pathAliases = [],
  rootDir,
}) {
  const errors = [];
  const decisions = array(manifest?.decisions);
  const gaps = array(manifest?.gaps);
  const contracts = array(manifest?.contracts);
  const tickets = array(manifest?.tickets);
  const decisionById = new Map(decisions.map((item) => [item.id, item]));
  const gapById = new Map(gaps.map((item) => [item.id, item]));
  const contractById = new Map(contracts.map((item) => [item.id, item]));
  const ticketById = new Map(tickets.map((item) => [item.id, item]));

  for (const [label, items] of [
    ["decision", decisions],
    ["gap", gaps],
    ["contract", contracts],
    ["ticket", tickets],
  ]) {
    for (const id of duplicateIds(items)) errors.push(`duplicate ${label} id ${id}`);
  }

  const requiredGapIds = array(manifest?.requiredGapIds);
  for (const gapId of requiredGapIds) {
    if (!gapById.has(gapId)) errors.push(`required gap ${gapId} is missing`);
  }

  const invariants = manifest?.invariants ?? {};
  if (invariants.streaming?.mode !== "token") {
    errors.push("streaming invariant must remain token-level");
  }
  if (
    invariants.d4?.selection !== "single" ||
    invariants.d4?.candidateCount !== 3 ||
    invariants.d4?.maxFreeRetries !== 2
  ) {
    errors.push("D4 must remain 3-to-1 single selection with at most 2 free retries");
  }
  if (invariants.l1LinkCapture?.status !== "de_scoped") {
    errors.push("L-1 link capture must remain de-scoped");
  }
  if (
    invariants.mediaModelSelection?.explicit !== true ||
    invariants.mediaModelSelection?.crossBrandAuto !== false
  ) {
    errors.push("media model selection must be explicit with no cross-brand Auto");
  }

  for (const decision of decisions) {
    if (!ALLOWED_DECISION_STATUSES.has(decision.status)) {
      errors.push(`decision ${decision.id} has invalid status ${decision.status}`);
    }
    if (decision.status === "active" && array(decision.ticketIds).length === 0) {
      errors.push(`active decision ${decision.id} has no owning ticket`);
    }
    if (decision.status !== "active" && array(decision.ticketIds).length > 0) {
      errors.push(`non-active decision ${decision.id} must not own implementation tickets`);
    }
    if (!decision.userVisibleContract || !decision.evidencePair) {
      errors.push(`decision ${decision.id} lacks user-visible contract or evidence pair`);
    }
    const sourcePath = decision.source?.path;
    if (!sourcePath) {
      errors.push(`decision ${decision.id} lacks a source path`);
    } else {
      try {
        const source = await readFile(
          resolveRepoPath(rootDir, sourcePath, pathAliases),
          "utf8",
        );
        if (!decision.source.contains || !source.includes(decision.source.contains)) {
          errors.push(
            `decision ${decision.id} source anchor is missing from ${sourcePath}`,
          );
        }
      } catch {
        errors.push(`decision ${decision.id} source does not exist: ${sourcePath}`);
      }
    }
    for (const gapId of array(decision.gapIds)) {
      if (!gapById.has(gapId)) errors.push(`decision ${decision.id} references missing gap ${gapId}`);
    }
    for (const ticketId of array(decision.ticketIds)) {
      if (!ticketById.has(ticketId)) {
        errors.push(`decision ${decision.id} references missing ticket ${ticketId}`);
      } else if (!array(ticketById.get(ticketId).decisionIds).includes(decision.id)) {
        errors.push(`decision ${decision.id} is not declared by ticket ${ticketId}`);
      }
    }
  }

  for (const gap of gaps) {
    if (array(gap.ticketIds).length === 0) errors.push(`gap ${gap.id} has no owning ticket`);
    for (const ticketId of array(gap.ticketIds)) {
      const ticket = ticketById.get(ticketId);
      if (!ticket) errors.push(`gap ${gap.id} references missing ticket ${ticketId}`);
      else if (!array(ticket.gapIds).includes(gap.id)) {
        errors.push(`gap ${gap.id} is not declared by ticket ${ticketId}`);
      }
    }
  }

  for (const contract of contracts) {
    if (contract.level !== "required") {
      errors.push(`experience contract ${contract.id} must be required`);
    }
    if (array(contract.ticketIds).length === 0) {
      errors.push(`experience contract ${contract.id} has no owning ticket`);
    }
    for (const gapId of array(contract.gapIds)) {
      if (!gapById.has(gapId)) {
        errors.push(`experience contract ${contract.id} references missing gap ${gapId}`);
      }
    }
    for (const ticketId of array(contract.ticketIds)) {
      const ticket = ticketById.get(ticketId);
      if (!ticket) {
        errors.push(`experience contract ${contract.id} references missing ticket ${ticketId}`);
      } else if (!array(ticket.contractIds).includes(contract.id)) {
        errors.push(`experience contract ${contract.id} is not declared by ticket ${ticketId}`);
      }
    }
  }

  for (const ticket of tickets) {
    if (!ALLOWED_TICKET_STATUSES.has(ticket.status)) {
      errors.push(`ticket ${ticket.id} has invalid status ${ticket.status}`);
    }
    const resolution = ticket.resolution ?? (ticket.status === "closed" ? "completed" : null);
    if (resolution && !ALLOWED_TICKET_RESOLUTIONS.has(resolution)) {
      errors.push(`ticket ${ticket.id} has invalid resolution ${resolution}`);
    }
    if (ticket.status === "open" && resolution) {
      errors.push(`open ticket ${ticket.id} must not have a closure resolution`);
    }
    for (const decisionId of array(ticket.decisionIds)) {
      const decision = decisionById.get(decisionId);
      if (!decision) errors.push(`ticket ${ticket.id} references missing decision ${decisionId}`);
      else if (!array(decision.ticketIds).includes(ticket.id)) {
        errors.push(`ticket ${ticket.id} is not declared by decision ${decisionId}`);
      }
    }
    for (const decisionId of array(ticket.guardrailDecisionIds)) {
      const decision = decisionById.get(decisionId);
      if (!decision) {
        errors.push(`ticket ${ticket.id} references missing guardrail decision ${decisionId}`);
      } else if (decision.status === "active") {
        errors.push(`ticket ${ticket.id} uses active decision ${decisionId} as a guardrail`);
      }
    }
    for (const gapId of array(ticket.gapIds)) {
      const gap = gapById.get(gapId);
      if (!gap) errors.push(`ticket ${ticket.id} references missing gap ${gapId}`);
      else if (!array(gap.ticketIds).includes(ticket.id)) {
        errors.push(`ticket ${ticket.id} is not declared by gap ${gapId}`);
      }
    }
    for (const contractId of array(ticket.contractIds)) {
      const contract = contractById.get(contractId);
      if (!contract) errors.push(`ticket ${ticket.id} references missing contract ${contractId}`);
      else if (!array(contract.ticketIds).includes(ticket.id)) {
        errors.push(`ticket ${ticket.id} is not declared by contract ${contractId}`);
      }
    }
    for (const dependencyId of array(ticket.blockedBy)) {
      const dependency = ticketById.get(dependencyId);
      if (!dependency) {
        errors.push(`ticket ${ticket.id} has missing dependency ${dependencyId}`);
      } else if (ticket.status === "closed" && dependency.status !== "closed") {
        errors.push(`closed ticket ${ticket.id} depends on open ticket ${dependencyId}`);
      }
    }
    if (ticket.status === "closed") {
      if (array(ticket.closureEvidence).length === 0) {
        errors.push(`closed ticket ${ticket.id} has no closure evidence`);
      }
      for (const evidencePath of array(ticket.closureEvidence)) {
        try {
          await access(resolveRepoPath(rootDir, evidencePath, pathAliases));
        } catch {
          errors.push(`closed ticket ${ticket.id} has missing evidence ${evidencePath}`);
        }
      }
    }
    try {
      await access(resolveRepoPath(rootDir, ticket.file, pathAliases));
      const metadata = await readTicketMetadata(rootDir, ticket, pathAliases);
      const expectedMetadata = {
        ticketId: ticket.id,
        decisionIds: array(ticket.decisionIds),
        guardrailDecisionIds: array(ticket.guardrailDecisionIds),
        gapIds: array(ticket.gapIds),
        contractIds: array(ticket.contractIds),
        blockedBy: array(ticket.blockedBy),
        closureEvidence: array(ticket.closureEvidence),
        resolution: ticket.resolution ?? (ticket.status === "closed" ? "completed" : null),
        status: ticket.status,
      };
      const normalizedMetadata = {
        ticketId: metadata.ticketId,
        decisionIds: array(metadata.decisionIds),
        guardrailDecisionIds: array(metadata.guardrailDecisionIds),
        gapIds: array(metadata.gapIds),
        contractIds: array(metadata.contractIds),
        blockedBy: array(metadata.blockedBy),
        closureEvidence: array(metadata.closureEvidence),
        resolution: metadata.resolution ?? (metadata.status === "closed" ? "completed" : null),
        status: metadata.status,
      };
      for (const field of [
        "decisionIds",
        "guardrailDecisionIds",
        "gapIds",
        "contractIds",
        "blockedBy",
        "closureEvidence",
      ]) {
        if (!sameStrings(normalizedMetadata[field], expectedMetadata[field])) {
          errors.push(`ticket metadata drift for ${ticket.id}: ${field}`);
        }
      }
      if (
        normalizedMetadata.ticketId !== expectedMetadata.ticketId ||
        normalizedMetadata.status !== expectedMetadata.status ||
        normalizedMetadata.resolution !== expectedMetadata.resolution
      ) {
        errors.push(`ticket metadata drift for ${ticket.id}: identity or status`);
      }
    } catch (error) {
      errors.push(`ticket metadata error for ${ticket.id}: ${error.message}`);
    }
  }

  const gateTicketId =
    typeof manifest?.gateTicketId === "string" ? manifest.gateTicketId : "02";
  const gateTicket = ticketById.get(gateTicketId);
  if (gateTicket?.status !== "closed" && tickets.some((ticket) => ticket.status === "closed")) {
    errors.push(`ticket ${gateTicketId} must be complete before any ticket can be closed`);
  }

  const cycle = findDependencyCycle(tickets);
  if (cycle) errors.push(`ticket dependency cycle: ${cycle.join(" -> ")}`);

  return errors;
}

async function main() {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const rootDir =
    rootFlag === -1 ? process.cwd() : path.resolve(process.cwd(), argv[rootFlag + 1]);
  const manifestPaths = [
    "docs/ledgers/uiux-upgrade-b/decision-ticket-map.json",
    "docs/ledgers/contentpackage-productization/decision-ticket-map.json",
  ];
  let failed = false;
  for (const relativePath of manifestPaths) {
    const manifestPath = path.resolve(rootDir, relativePath);
    const source = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(source);
    const errors = await validateDecisionTicketMap({
      manifest,
      pathAliases: TRACKED_LEDGER_PATH_ALIASES,
      rootDir,
    });
    if (errors.length > 0) {
      failed = true;
      for (const error of errors) console.error(`- [${relativePath}] ${error}`);
      continue;
    }
    console.log(
      `Decision-ticket guard passed (${relativePath}): ${manifest.decisions.length} decisions, ${manifest.gaps.length} gaps, ${manifest.contracts.length} contracts, ${manifest.tickets.length} tickets.`,
    );
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
