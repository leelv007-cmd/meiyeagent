/**
 * The Waffo Test preview configuration binds Hyperdrive while the release
 * configuration intentionally does not. Keep this candidate-only binding
 * declaration separate from generated release Worker types.
 */
declare namespace Cloudflare {
  interface Env {
    HYPERDRIVE: Hyperdrive;
  }
}
