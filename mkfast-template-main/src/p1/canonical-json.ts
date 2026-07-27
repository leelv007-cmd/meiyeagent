/**
 * Order-independent JSON canonicalisation and a stable digest over it.
 *
 * Both exist for request identity: an idempotency key has to be a function of
 * what the request *says*, not of the order a JS object happened to be built
 * in. Two callers that assemble the same payload with different key order must
 * land on the same key, and any change to the payload must land on a different
 * one (#240 — a quote key that ignored part of its own payload turned an edited
 * intent into a same-key-different-body conflict).
 */

export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)])
    );
  }
  return value;
}

export function canonicalJsonString(value: unknown) {
  return JSON.stringify(canonicalJsonValue(value));
}

/**
 * 64-bit FNV-1a-style digest, hex encoded.
 *
 * Deliberately synchronous — the callers derive an identity inside a render
 * pass, where `crypto.subtle.digest` (async) cannot be used. This is a
 * partitioning digest, not a security primitive: nothing downstream trusts it
 * to be unforgeable, it only has to change whenever the payload changes.
 */
export function stableJsonHash(value: unknown) {
  const serialized = canonicalJsonString(value);
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x85ebca6b);
  }
  return (
    (low >>> 0).toString(16).padStart(8, '0') +
    (high >>> 0).toString(16).padStart(8, '0')
  );
}
