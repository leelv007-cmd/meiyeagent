/**
 * MP-08 fault-injection domain (I4).
 * Dual-channel + official single-channel matrix unit path + publish gate.
 * Live path is env-gated (never projects recorded as live_verified).
 */
export * from './types.js';
export * from './channel-label.js';
export * from './matrix-models.js';
export * from './publish-gate.js';
export * from './dual-channel-router.js';
export * from './matrix.js';
export * from './single-channel-matrix.js';
export * from './fakes.js';
