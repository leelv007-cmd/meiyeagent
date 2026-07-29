export type PredicateFact =
  | null
  | boolean
  | number
  | string
  | readonly PredicateFact[]
  | { readonly [key: string]: PredicateFact };

export type DeepReadonly<Value> =
  Value extends (...args: never[]) => unknown
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

export type PurePredicate<Facts> = (
  facts: DeepReadonly<Facts>,
) => boolean;

/**
 * D-167 predicate boundary: the decision gets data only, never runtime or
 * persistence capabilities. Side effects belong to the transition owner after
 * this synchronous decision returns.
 */
export function evaluatePurePredicate<Facts>(
  facts: Facts,
  predicate: PurePredicate<Facts>,
) {
  assertPlainFacts(facts);
  const snapshot = deepFreeze(structuredClone(facts)) as DeepReadonly<Facts>;
  const decision = predicate(snapshot);
  if (typeof decision !== 'boolean') {
    throw new TypeError('A pure predicate must synchronously return a boolean.');
  }
  return decision;
}

function assertPlainFacts(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertPlainFacts(item);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Pure predicate facts must be plain data.');
  }
  for (const item of Object.values(value)) {
    assertPlainFacts(item);
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}
