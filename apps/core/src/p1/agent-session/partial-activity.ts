/**
 * Partial output Activity surface (V3.1 §19.3).
 *
 * partialOutputStream may only touch temporary Activity / non-authoritative
 * preview. Repair / final schema-valid output replaces the same stable ID —
 * never appends a duplicate object.
 */

export type ActivityStatus = 'forming' | 'draft' | 'confirmed';

export type TemporaryActivity = {
  stableId: string;
  status: ActivityStatus;
  payload: unknown;
  authoritative: false;
  updatedAt: string;
};

export class PartialActivityError extends Error {
  readonly code = 'PARTIAL_ACTIVITY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PartialActivityError';
  }
}

export class PartialActivityBuffer {
  private readonly activities = new Map<string, TemporaryActivity>();

  /**
   * Upsert a temporary (non-authoritative) activity by stable ID.
   * Partial streams must use status forming|draft only.
   */
  upsertPartial(input: {
    stableId: string;
    payload: unknown;
    status?: Exclude<ActivityStatus, 'confirmed'>;
    now?: string;
  }): TemporaryActivity {
    if (!input.stableId.trim()) {
      throw new PartialActivityError('stableId is required for partial activity.');
    }
    const status = input.status ?? 'forming';
    if (status === ('confirmed' as ActivityStatus)) {
      throw new PartialActivityError(
        'Partial stream cannot write confirmed status; use replaceWithFinal.',
      );
    }
    const existing = this.activities.get(input.stableId);
    const next: TemporaryActivity = {
      stableId: input.stableId,
      status,
      payload: input.payload,
      authoritative: false,
      updatedAt: input.now ?? new Date().toISOString(),
    };
    // Same stable ID always replaces — never append a second entry.
    this.activities.set(input.stableId, next);
    if (existing && existing.stableId !== next.stableId) {
      throw new PartialActivityError('stableId mismatch on replace.');
    }
    return { ...next };
  }

  /**
   * After schema repair / final parse: replace the same stable ID.
   * Status becomes confirmed only for the final object; still non-authoritative
   * until a domain writer (plan compiler etc.) commits — Activity stays preview.
   */
  replaceWithFinal(input: {
    stableId: string;
    payload: unknown;
    now?: string;
  }): TemporaryActivity {
    if (!input.stableId.trim()) {
      throw new PartialActivityError('stableId is required for final activity.');
    }
    const next: TemporaryActivity = {
      stableId: input.stableId,
      status: 'draft',
      payload: input.payload,
      authoritative: false,
      updatedAt: input.now ?? new Date().toISOString(),
    };
    this.activities.set(input.stableId, next);
    return { ...next };
  }

  get(stableId: string): TemporaryActivity | null {
    const value = this.activities.get(stableId);
    return value ? { ...value } : null;
  }

  list(): TemporaryActivity[] {
    return [...this.activities.values()].map((item) => ({ ...item }));
  }

  /** Constructive: buffer never holds two rows for one stableId. */
  countFor(stableId: string): number {
    return this.activities.has(stableId) ? 1 : 0;
  }
}
