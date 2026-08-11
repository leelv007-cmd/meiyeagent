/**
 * V3.1 ticket-index governance (FIX-P0-00).
 *
 * Ticket files under docs/tickets/v3.1/V31-*.md are the source of truth for
 * Status. The README status table must mirror those values exactly.
 *
 * Supported ticket Status forms (first match wins):
 *   **Status**: <value>
 *   - Status: <value>
 *
 * Usage:
 *   node scripts/ci/assert-v31-ticket-index.mjs            # check (default)
 *   node scripts/ci/assert-v31-ticket-index.mjs --check
 *   node scripts/ci/assert-v31-ticket-index.mjs --generate  # print markdown table
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const defaultTicketsDir = join(repositoryRoot, 'docs/tickets/v3.1');
const defaultReadmePath = join(defaultTicketsDir, 'README.md');

const TICKET_FILE_RE = /^V31-(\d+).*\.md$/u;
const TITLE_RE = /^#\s+(V31-\d+)\s*[—–-]+\s*(.+)$/mu;
// Bold (**Status**:) and list (- Status:) header forms. First match in file wins.
const STATUS_RE = /^(?:\*\*Status\*\*|-\s*Status):\s*(.+)$/mu;
const README_ROW_RE = /^\|\s*(V31-\d+)\s*\|/u;

/**
 * @param {string} text
 * @returns {{ status: string | null, form: 'bold' | 'list' | null, title: string | null }}
 */
export function extractTicketFields(text) {
  const titleMatch = text.match(TITLE_RE);
  const title = titleMatch ? titleMatch[2].trim() : null;

  const statusMatch = text.match(STATUS_RE);
  if (!statusMatch) {
    return { status: null, form: null, title };
  }

  const rawLine = statusMatch[0];
  const form = rawLine.startsWith('**') ? 'bold' : 'list';
  return {
    status: statusMatch[1].trim(),
    form,
    title,
  };
}

/**
 * Parse README markdown table rows that carry a V31-* id in column 1.
 * Expects `| id | title | status |` (exactly three content columns).
 *
 * @param {string} readmeText
 * @returns {Map<string, { status: string, titleCell: string, line: string }>}
 */
export function parseReadmeStatusTable(readmeText) {
  const rows = new Map();

  for (const line of readmeText.split('\n')) {
    if (!README_ROW_RE.test(line)) continue;

    // Split on unescaped pipes: keep empty edge cells from leading/trailing |.
    const cells = [];
    let current = '';
    let escaped = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '|') {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());

    // cells: ['', id, title, status, ''] for a well-formed row
    const content = cells.filter((cell, index) => {
      if (index === 0 && cell === '') return false;
      if (index === cells.length - 1 && cell === '') return false;
      return true;
    });

    if (content.length < 3) continue;
    const id = content[0];
    if (!/^V31-\d+$/u.test(id)) continue;

    const status = content[content.length - 1];
    const titleCell = content.slice(1, -1).join(' | ');
    rows.set(id, { status, titleCell, line });
  }

  return rows;
}

function escapeTableCell(value) {
  return value.replace(/\|/gu, '\\|');
}

function ticketSortKey(fileName) {
  const match = fileName.match(TICKET_FILE_RE);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/**
 * @param {string} ticketsDir
 * @returns {Promise<Array<{
 *   id: string,
 *   fileName: string,
 *   filePath: string,
 *   status: string | null,
 *   form: 'bold' | 'list' | null,
 *   title: string | null,
 * }>>}
 */
export async function loadTickets(ticketsDir) {
  const entries = await readdir(ticketsDir);
  const files = entries
    .filter((name) => TICKET_FILE_RE.test(name))
    .sort((a, b) => ticketSortKey(a) - ticketSortKey(b));

  const tickets = [];
  for (const fileName of files) {
    const filePath = join(ticketsDir, fileName);
    const text = await readFile(filePath, 'utf8');
    const fields = extractTicketFields(text);
    const idMatch = fileName.match(/^(V31-\d+)/u);
    tickets.push({
      id: idMatch[1],
      fileName,
      filePath,
      status: fields.status,
      form: fields.form,
      title: fields.title,
    });
  }
  return tickets;
}

/**
 * @param {{
 *   tickets: Array<{ id: string, fileName: string, status: string | null, form: string | null, title: string | null }>,
 *   readmeRows: Map<string, { status: string, titleCell: string, line: string }>,
 * }} input
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkTicketIndex({ tickets, readmeRows }) {
  const errors = [];
  const warnings = [];
  const ticketIds = new Set(tickets.map((ticket) => ticket.id));

  for (const ticket of tickets) {
    if (!ticket.status) {
      errors.push(
        `${ticket.id} (${ticket.fileName}): missing Status (need **Status**: or - Status:)`,
      );
      continue;
    }

    const row = readmeRows.get(ticket.id);
    if (!row) {
      errors.push(
        `${ticket.id}: present as ${ticket.fileName} but missing from README status table`,
      );
      continue;
    }

    if (row.status !== ticket.status) {
      errors.push(
        `${ticket.id}: README status drifts from ticket\n` +
          `  README: ${row.status}\n` +
          `  ticket: ${ticket.status}`,
      );
    }
  }

  for (const id of readmeRows.keys()) {
    if (!ticketIds.has(id)) {
      errors.push(
        `${id}: listed in README status table but no matching V31-*.md ticket file`,
      );
    }
  }

  const listForm = tickets.filter((ticket) => ticket.form === 'list');
  if (listForm.length > 0) {
    warnings.push(
      `list-style Status (- Status:) on: ${listForm.map((t) => t.id).join(', ')}`,
    );
  }

  return { errors, warnings };
}

/**
 * @param {Array<{ id: string, fileName: string, status: string | null, title: string | null }>} tickets
 * @returns {string}
 */
export function generateStatusTable(tickets) {
  const lines = [
    '| 票 | 标题 | Status（票面原文） |',
    '|---|---|---|',
  ];

  for (const ticket of tickets) {
    const titleText = ticket.title ?? ticket.id;
    const titleCell = `[${escapeTableCell(titleText)}](${ticket.fileName})`;
    const statusCell = escapeTableCell(ticket.status ?? 'MISSING_STATUS');
    lines.push(`| ${ticket.id} | ${titleCell} | ${statusCell} |`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * @param {{ ticketsDir?: string, readmePath?: string }} [options]
 */
export async function assertV31TicketIndex(options = {}) {
  const ticketsDir = options.ticketsDir ?? defaultTicketsDir;
  const readmePath = options.readmePath ?? defaultReadmePath;

  const tickets = await loadTickets(ticketsDir);
  const readmeText = await readFile(readmePath, 'utf8');
  const readmeRows = parseReadmeStatusTable(readmeText);
  const { errors, warnings } = checkTicketIndex({ tickets, readmeRows });

  return {
    tickets,
    readmeRows,
    errors,
    warnings,
    table: generateStatusTable(tickets),
  };
}

function parseArgs(argv) {
  const args = new Set(argv);
  if (args.has('--generate')) return 'generate';
  if (args.has('--help') || args.has('-h')) return 'help';
  return 'check';
}

function printHelp() {
  process.stdout.write(`V3.1 ticket-index governance

Usage:
  node scripts/ci/assert-v31-ticket-index.mjs [--check]
  node scripts/ci/assert-v31-ticket-index.mjs --generate

--check (default)  Fail closed when README Status column drifts from ticket files.
--generate         Print a full markdown status table derived from ticket files.
`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const mode = parseArgs(process.argv.slice(2));

  if (mode === 'help') {
    printHelp();
  } else if (mode === 'generate') {
    const tickets = await loadTickets(defaultTicketsDir);
    process.stdout.write(generateStatusTable(tickets));
  } else {
    const { errors, warnings, tickets, readmeRows } =
      await assertV31TicketIndex();

    for (const warning of warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }

    if (errors.length > 0) {
      process.stderr.write(
        `V3.1 ticket-index governance failed (fail closed):\n${errors
          .map((error) => `- ${error}`)
          .join('\n')}\n`,
      );
      process.stderr.write(
        `\nFix: update docs/tickets/v3.1/README.md Status column to match each ticket, or regenerate with:\n` +
          `  node scripts/ci/assert-v31-ticket-index.mjs --generate\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `V3.1 ticket index OK: ${tickets.length} tickets, ${readmeRows.size} README rows.\n`,
      );
    }
  }
}
