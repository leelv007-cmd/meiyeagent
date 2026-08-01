import type {
  CreateSensitiveWordCommand,
  ListSensitiveWordsQuery,
  SensitiveWordRecord,
  UpdateSensitiveWordCommand,
} from '@meiye/contracts';

import { BEAUTY_FIXTURE_SENSITIVE_LEXICON } from './beauty-fixture-lexicon.js';

export interface SensitiveWordsRepository {
  list(query?: ListSensitiveWordsQuery): Promise<SensitiveWordRecord[]>;
  listEnabled(): Promise<SensitiveWordRecord[]>;
  get(id: string): Promise<SensitiveWordRecord | null>;
  create(input: CreateSensitiveWordCommand): Promise<SensitiveWordRecord>;
  update(input: UpdateSensitiveWordCommand): Promise<SensitiveWordRecord>;
  delete(id: string): Promise<{ id: string; deleted: true }>;
  /** Seed platform baseline when empty (idempotent). */
  ensurePlatformBaseline(): Promise<{ seeded: number }>;
}

function matchesQuery(
  row: SensitiveWordRecord,
  query: ListSensitiveWordsQuery | undefined,
): boolean {
  if (!query) return true;
  if (query.category && row.category !== query.category) return false;
  if (query.status && row.status !== query.status) return false;
  if (query.q) {
    const needle = query.q.normalize('NFKC').toLowerCase();
    const hay = `${row.word} ${row.replacements.join(' ')}`
      .normalize('NFKC')
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export class MemorySensitiveWordsRepository implements SensitiveWordsRepository {
  private readonly byId = new Map<string, SensitiveWordRecord>();
  private seq = 0;

  constructor(seed: readonly SensitiveWordRecord[] = []) {
    for (const row of seed) {
      this.byId.set(row.id, structuredClone(row));
    }
  }

  async list(query?: ListSensitiveWordsQuery) {
    return [...this.byId.values()]
      .filter((row) => matchesQuery(row, query))
      .sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
  }

  async listEnabled() {
    return this.list({ status: 'enabled' });
  }

  async get(id: string) {
    const row = this.byId.get(id);
    return row ? structuredClone(row) : null;
  }

  async create(input: CreateSensitiveWordCommand) {
    this.seq += 1;
    const now = new Date().toISOString();
    const row: SensitiveWordRecord = {
      id: `sw-mem-${this.seq}`,
      word: input.word.trim(),
      category: input.category,
      replacements: [...input.replacements],
      status: input.status,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(row.id, row);
    return structuredClone(row);
  }

  async update(input: UpdateSensitiveWordCommand) {
    const current = this.byId.get(input.id);
    if (!current) {
      throw new Error(`Sensitive word ${input.id} was not found.`);
    }
    const next: SensitiveWordRecord = {
      ...current,
      word: input.word?.trim() ?? current.word,
      category: input.category ?? current.category,
      replacements: input.replacements
        ? [...input.replacements]
        : current.replacements,
      status: input.status ?? current.status,
      updatedAt: new Date().toISOString(),
    };
    this.byId.set(next.id, next);
    return structuredClone(next);
  }

  async delete(id: string) {
    if (!this.byId.has(id)) {
      throw new Error(`Sensitive word ${id} was not found.`);
    }
    this.byId.delete(id);
    return { id, deleted: true as const };
  }

  async ensurePlatformBaseline() {
    if (this.byId.size > 0) return { seeded: 0 };
    for (const row of BEAUTY_FIXTURE_SENSITIVE_LEXICON) {
      this.byId.set(row.id, structuredClone(row));
    }
    return { seeded: BEAUTY_FIXTURE_SENSITIVE_LEXICON.length };
  }
}
