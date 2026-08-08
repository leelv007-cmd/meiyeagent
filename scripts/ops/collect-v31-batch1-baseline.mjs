#!/usr/bin/env node
/**
 * V31-05 / V3.1 §38 baseline collector scaffold.
 *
 * Default mode emits the metric schema + empty rows. Does not invent numbers.
 * When V31_BASELINE_SOURCE points at an NDJSON export of product events,
 * --mode=from-export aggregates known metric keys (best-effort).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const METRICS = [
  { key: 'hard.rights_billing_errors', layer: 'hard', aggregate: 'count' },
  { key: 'hard.snapshot_mismatch', layer: 'hard', aggregate: 'count' },
  { key: 'hard.duplicate_debit', layer: 'hard', aggregate: 'count' },
  { key: 'hard.pending_interrupt_lost', layer: 'hard', aggregate: 'count' },
  { key: 'hard.day0_simple_task_p75_ms', layer: 'hard', aggregate: 'p75' },
  { key: 'latency.acknowledgment_p75_ms', layer: 'observe', aggregate: 'p75' },
  { key: 'latency.first_activity_p75_ms', layer: 'observe', aggregate: 'p75' },
  { key: 'latency.memory_retrieval_p95_ms', layer: 'observe', aggregate: 'p95' },
  { key: 'latency.intent_ready_p75_ms', layer: 'observe', aggregate: 'p75' },
  { key: 'latency.level1_plan_p75_ms', layer: 'observe', aggregate: 'p75' },
  { key: 'latency.level2_plan_p75_ms', layer: 'observe', aggregate: 'p75' },
  { key: 'latency.steering_ack_p95_ms', layer: 'observe', aggregate: 'p95' },
  { key: 'latency.reconnect_snapshot_p95_ms', layer: 'observe', aggregate: 'p95' },
  { key: 'latency.semantic_projection_lag_p99_ms', layer: 'observe', aggregate: 'p99' },
  {
    key: 'funnel.intent_to_delivered_rate',
    layer: 'observe',
    aggregate: 'rate',
  },
  {
    key: 'funnel.delivered_to_outcome_7d_rate',
    layer: 'observe',
    aggregate: 'rate',
  },
];

function parseArgs(argv) {
  const out = { mode: 'schema', out: null };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) out.mode = arg.slice('--mode='.length);
    if (arg.startsWith('--out=')) out.out = arg.slice('--out='.length);
  }
  return out;
}

function emptyRows() {
  return METRICS.map((metric) => ({
    ...metric,
    value: null,
    sampleSize: 0,
    window: null,
    note: 'n/a — no data source',
  }));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function aggregateFromExport(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const byKey = new Map();
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row.metric !== 'string') continue;
    const list = byKey.get(row.metric) ?? [];
    if (typeof row.value === 'number' && Number.isFinite(row.value)) {
      list.push(row.value);
    }
    byKey.set(row.metric, list);
  }

  return METRICS.map((metric) => {
    const values = (byKey.get(metric.key) ?? []).slice().sort((a, b) => a - b);
    let value = null;
    if (metric.aggregate === 'count') {
      value = values.reduce((sum, item) => sum + item, 0);
    } else if (metric.aggregate === 'p75') {
      value = percentile(values, 75);
    } else if (metric.aggregate === 'p95') {
      value = percentile(values, 95);
    } else if (metric.aggregate === 'p99') {
      value = percentile(values, 99);
    } else if (metric.aggregate === 'rate') {
      value =
        values.length === 0
          ? null
          : values.reduce((sum, item) => sum + item, 0) / values.length;
    }
    return {
      ...metric,
      value,
      sampleSize: values.length,
      window: process.env.V31_BASELINE_WINDOW ?? null,
      note: values.length === 0 ? 'no samples for metric' : 'from-export',
    };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const capturedAt = new Date().toISOString();
  let rows = emptyRows();
  let source = 'schema-only';

  if (args.mode === 'from-export') {
    const path = process.env.V31_BASELINE_SOURCE;
    if (!path) {
      console.error(
        'V31_BASELINE_SOURCE is required for --mode=from-export (NDJSON path).',
      );
      process.exit(2);
    }
    rows = aggregateFromExport(path);
    source = path;
  } else if (args.mode !== 'schema') {
    console.error(`Unknown mode: ${args.mode}`);
    process.exit(2);
  }

  const payload = {
    schemaVersion: 'v31-batch1-baseline/v1',
    authority: 'V3.1 §38',
    ticket: 'V31-05',
    capturedAt,
    source,
    dataWindow: process.env.V31_BASELINE_WINDOW ?? null,
    metrics: rows,
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.out) {
    const outPath = resolve(process.cwd(), args.out);
    writeFileSync(outPath, json, 'utf8');
    console.log(`wrote ${outPath}`);
  } else {
    process.stdout.write(json);
  }
}

main();
