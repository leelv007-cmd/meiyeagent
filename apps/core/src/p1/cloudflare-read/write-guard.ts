/**
 * Write-op denial surface for the Cloudflare read adapter (D-053).
 *
 * Adapter only exposes an allowlisted set of read methods. Any attempt to
 * invoke a control-plane write verb is denied — including verbs that are not
 * even implemented as methods (negative contract).
 */

import {
  CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS,
  CLOUDFLARE_INVENTORY_READ_METHODS,
  type CloudflareInventoryAdapter,
  type CloudflareInventoryReadMethod,
} from './inventory-adapter.js';
import {
  CLOUDFLARE_WRITE_ACTIONS,
  type CloudflareWriteAction,
} from './permissions.js';

export class CloudflareWriteDeniedError extends Error {
  readonly code = 'cloudflare_write_denied' as const;

  constructor(
    readonly action: string,
    message?: string,
  ) {
    super(
      message ??
        `Cloudflare write action "${action}" is forbidden (D-053 read-only)`,
    );
    this.name = 'CloudflareWriteDeniedError';
  }
}

/** All adapter own-property function names that are allowed. */
export function listAdapterAllowedMethods(
  adapter: CloudflareInventoryAdapter,
): string[] {
  const allowed = new Set<string>(CLOUDFLARE_INVENTORY_READ_METHODS);
  const found: string[] = [];
  // Prototype methods (class methods)
  let proto: object | null = Object.getPrototypeOf(adapter);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc && typeof desc.value === 'function') {
        found.push(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  // Ensure every found public method is allowlisted.
  for (const name of found) {
    if (!allowed.has(name as CloudflareInventoryReadMethod)) {
      // private methods start with nothing special in JS — filter known private helpers
      if (isPrivateHelper(name)) continue;
      throw new Error(
        `CloudflareInventoryAdapter exposes non-allowlisted method: ${name}`,
      );
    }
  }
  return CLOUDFLARE_INVENTORY_READ_METHODS.slice();
}

function isPrivateHelper(name: string): boolean {
  return (
    name.startsWith('query') ||
    name.startsWith('cf') ||
    name.startsWith('unknown') ||
    name === 'now'
  );
}

/**
 * Deny a write action. Always throws — product admin must never succeed.
 */
export function denyCloudflareWriteAction(action: string): never {
  throw new CloudflareWriteDeniedError(action);
}

/** True if the action is a known CF control-plane write verb. */
export function isCloudflareWriteAction(
  action: string,
): action is CloudflareWriteAction {
  return (CLOUDFLARE_WRITE_ACTIONS as readonly string[]).includes(action);
}

/**
 * Guard: if action is a write verb, throw; otherwise return false
 * (caller may continue with non-CF handling).
 */
export function assertCloudflareWriteDenied(action: string): void {
  if (
    isCloudflareWriteAction(action) ||
    (CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS as readonly string[]).includes(
      action,
    )
  ) {
    denyCloudflareWriteAction(action);
  }
}

/**
 * Runtime check that adapter instance does not implement forbidden methods.
 * Returns the list of forbidden method names that are present (should be empty).
 */
export function findForbiddenMethodsOnAdapter(
  adapter: object,
): string[] {
  const present: string[] = [];
  for (const name of CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS) {
    const value = (adapter as Record<string, unknown>)[name];
    if (typeof value === 'function') {
      present.push(name);
    }
  }
  // Also walk prototype
  let proto: object | null = Object.getPrototypeOf(adapter);
  while (proto && proto !== Object.prototype) {
    for (const name of CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS) {
      if (name in proto && typeof (proto as Record<string, unknown>)[name] === 'function') {
        if (!present.includes(name)) present.push(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return present;
}

/** Full set of write verbs for negative authorization tests. */
export function listDeniedWriteActions(): readonly string[] {
  return [
    ...CLOUDFLARE_WRITE_ACTIONS,
    ...CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS,
  ];
}
