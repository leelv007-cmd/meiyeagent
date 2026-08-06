/**
 * Canonical three-state field merge for revisioned draft saves (Spec B / #359).
 *
 * Shared seam for Surface (this ticket) and Recipe optional collections (#361).
 * One definition — consumers must not reimplement per field.
 *
 * Semantics:
 * - input owns the field (including explicit empty) → use the input value
 * - input omits the field and a head revision exists → inherit head value
 * - input omits the field and no head exists → normalized default (arrays: [])
 *
 * Callers must read head and validate expectedRevision BEFORE merge/normalize/hash.
 */

/** True when `body` has its own property `key` (even if the value is empty). */
export function draftBodyOwnsField(body: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function cloneFieldValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return structuredClone(value);
}

export type ResolveThreeStateDraftFieldInput<T> = {
  /** Whether the request body owns the field key (Object.hasOwn / hasOwnProperty). */
  inputOwnsField: boolean;
  /**
   * Value when `inputOwnsField` is true.
   * Explicit empty collections (`[]`) clear the field; do not pass `undefined` for clear.
   */
  inputValue: T | undefined;
  /**
   * Head revision value when a head exists.
   * Pass `undefined` only when there is no head (create path).
   */
  headValue: T | undefined;
  /** Normalized default when creating with a missing field (arrays: `[]`). */
  defaultValue: T;
};

/**
 * Resolve one optional draft field under the three-state contract.
 *
 * Pure: does not read repositories or normalize. Clone head/default so callers
 * cannot mutate stored head through the merged body.
 */
export function resolveThreeStateDraftField<T>(
  input: ResolveThreeStateDraftFieldInput<T>,
): T {
  if (input.inputOwnsField) {
    // Present branch — including explicit empty. Caller validates shape later.
    return input.inputValue as T;
  }
  if (input.headValue !== undefined) {
    return cloneFieldValue(input.headValue);
  }
  return cloneFieldValue(input.defaultValue);
}

/**
 * Convenience for optional collection fields on a draft body object.
 * Recipe (#361) can call this for `factTypes` / `skillRevisionRefs`.
 */
export function resolveThreeStateCollectionField<T>(
  body: object,
  key: string,
  headValue: readonly T[] | undefined,
  defaultValue: readonly T[] = [],
): T[] {
  const inputOwnsField = draftBodyOwnsField(body, key);
  return resolveThreeStateDraftField({
    inputOwnsField,
    inputValue: inputOwnsField
      ? ((body as Record<string, unknown>)[key] as T[] | undefined)
      : undefined,
    headValue: headValue === undefined ? undefined : ([...headValue] as T[]),
    defaultValue: [...defaultValue] as T[],
  });
}
