/**
 * Provider conformance suite (MP-04T text; I2/I3 image/video; I4 MP-08 fault injection).
 * Runtime wiring is G3+Z2-WIRING; live matrix is env-gated (provider-live workflow).
 */
export * from './types.js';
export * from './mapping-confidence.js';
export * from './activation-evidence-input.js';
export * from './text/normalize.js';
export * from './text/fixtures.js';
export * from './text/runner.js';
export * from './text/dual-channel.js';
export * from './video/suite.js';
export * from './fault-injection/index.js';
export * from './live-provider-gate.js';
export * from './live-provider-adapters.js';
