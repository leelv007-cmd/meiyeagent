/**
 * Single late-bind seam for true construction cycles (R-P1-16).
 *
 * Required ports stay constructor-owned. Only a real cycle uses LateBound;
 * `seal()` must run before listen / worker start.
 */
export class LateBound<T> {
  #value: T | undefined;
  #sealed = false;

  constructor(readonly name: string) {}

  bind(value: T): void {
    if (this.#sealed) {
      throw new Error(`${this.name} is sealed`);
    }
    this.#value = value;
  }

  get value(): T {
    if (this.#value === undefined) {
      throw new Error(`${this.name} is not bound`);
    }
    return this.#value;
  }

  get bound(): boolean {
    return this.#value !== undefined;
  }

  get sealed(): boolean {
    return this.#sealed;
  }

  peek(): T | undefined {
    return this.#value;
  }

  seal(): T {
    if (this.#value === undefined) {
      throw new Error(`missing required port: ${this.name}`);
    }
    this.#sealed = true;
    return this.#value;
  }
}

export function sealLateBounds(
  bounds: readonly Pick<LateBound<unknown>, 'bound' | 'name' | 'seal'>[],
): void {
  const missing = bounds.filter((bound) => !bound.bound).map((bound) => bound.name);
  if (missing.length > 0) {
    throw new Error(`missing required port: ${missing.join(', ')}`);
  }
  for (const bound of bounds) bound.seal();
}
