/**
 * Provider conformance suite (MP-04T text dual-channel).
 * Runtime wiring is G3+Z2-WIRING; live matrix is env-gated
 * (`RUN_LIVE_TEXT_CONFORMANCE=1`).
 */
export * from './types.js';
export * from './mapping-confidence.js';
export * from './activation-evidence-input.js';
export * from './text/normalize.js';
export * from './text/fixtures.js';
export * from './text/runner.js';
export * from './text/dual-channel.js';
