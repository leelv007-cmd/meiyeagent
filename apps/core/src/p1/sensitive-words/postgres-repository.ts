import type {
  CreateSensitiveWordCommand,
  ListSensitiveWordsQuery,
  SensitiveWordCategory,
  SensitiveWordRecord,
  SensitiveWordStatus,
  UpdateSensitiveWordCommand,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import { BEAUTY_FIXTURE_SENSITIVE_LEXICON } from './beauty-fixture-lexicon.js';
import type { SensitiveWordsRepository } from './repository.js';

interface SensitiveWordRow {
  id: string;
  word: string;
  category: SensitiveWordCategory;
  replacements: unknown;
  status: SensitiveWordStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function replacementsFromDb(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      return [];
    }
  }
  return [];
}

function fromRow(row: SensitiveWordRow): SensitiveWordRecord {
  return {
    id: row.id,
    word: row.word,
    category: row.category,
    replacements: replacementsFromDb(row.replacements),
    status: row.status,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function newId(): string {
  return `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class PostgresSensitiveWordsRepository
  implements SensitiveWordsRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS sensitive_words (
        id text PRIMARY KEY,
        word text NOT NULL,
        category text NOT NULL
          CHECK (category IN (
            'extreme','medical','cosmetic','finance','legal','vulgar','other'
          )),
        replacements jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL CHECK (status IN ('enabled','disabled')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sensitive_words_status_idx
        ON sensitive_words (status);
      CREATE INDEX IF NOT EXISTS sensitive_words_category_idx
        ON sensitive_words (category);
      CREATE UNIQUE INDEX IF NOT EXISTS sensitive_words_word_unique_idx
        ON sensitive_words (lower(word));
    `);
  }

  async list(query?: ListSensitiveWordsQuery) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query?.category) {
      params.push(query.category);
      clauses.push(`category = $${params.length}`);
    }
    if (query?.status) {
      params.push(query.status);
      clauses.push(`status = $${params.length}`);
    }
    if (query?.q) {
      params.push(`%${query.q.normalize('NFKC').toLowerCase()}%`);
      clauses.push(
        `(lower(word) LIKE $${params.length} OR lower(replacements::text) LIKE $${params.length})`,
      );
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.pool.query<SensitiveWordRow>(
      `SELECT id, word, category, replacements, status, created_at, updated_at
       FROM sensitive_words
       ${where}
       ORDER BY char_length(word) DESC, word ASC`,
      params,
    );
    return result.rows.map(fromRow);
  }

  async listEnabled() {
    return this.list({ status: 'enabled' });
  }

  async get(id: string) {
    const result = await this.pool.query<SensitiveWordRow>(
      `SELECT id, word, category, replacements, status, created_at, updated_at
       FROM sensitive_words WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? fromRow(row) : null;
  }

  async create(input: CreateSensitiveWordCommand) {
    const id = newId();
    const result = await this.pool.query<SensitiveWordRow>(
      `INSERT INTO sensitive_words (id, word, category, replacements, status)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, word, category, replacements, status, created_at, updated_at`,
      [
        id,
        input.word.trim(),
        input.category,
        JSON.stringify(input.replacements),
        input.status,
      ],
    );
    return fromRow(result.rows[0]!);
  }

  async update(input: UpdateSensitiveWordCommand) {
    const current = await this.get(input.id);
    if (!current) {
      throw new Error(`Sensitive word ${input.id} was not found.`);
    }
    const next = {
      word: input.word?.trim() ?? current.word,
      category: input.category ?? current.category,
      replacements: input.replacements ?? current.replacements,
      status: input.status ?? current.status,
    };
    const result = await this.pool.query<SensitiveWordRow>(
      `UPDATE sensitive_words
       SET word = $2,
           category = $3,
           replacements = $4::jsonb,
           status = $5,
           updated_at = now()
       WHERE id = $1
       RETURNING id, word, category, replacements, status, created_at, updated_at`,
      [
        input.id,
        next.word,
        next.category,
        JSON.stringify(next.replacements),
        next.status,
      ],
    );
    return fromRow(result.rows[0]!);
  }

  async delete(id: string) {
    const result = await this.pool.query(
      `DELETE FROM sensitive_words WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) {
      throw new Error(`Sensitive word ${id} was not found.`);
    }
    return { id, deleted: true as const };
  }

  async ensurePlatformBaseline() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'LOCK TABLE sensitive_words IN SHARE ROW EXCLUSIVE MODE',
      );
      const count = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM sensitive_words',
      );
      if (Number(count.rows[0]?.n ?? 0) > 0) {
        await client.query('COMMIT');
        return { seeded: 0 };
      }

      let seeded = 0;
      for (const row of BEAUTY_FIXTURE_SENSITIVE_LEXICON) {
        const result = await client.query(
          `INSERT INTO sensitive_words (id, word, category, replacements, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $7::timestamptz)`,
          [
            row.id,
            row.word,
            row.category,
            JSON.stringify(row.replacements),
            row.status,
            row.createdAt,
            row.updatedAt,
          ],
        );
        seeded += result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return { seeded };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
