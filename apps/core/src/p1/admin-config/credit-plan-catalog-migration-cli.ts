import { Pool } from 'pg';

import {
  applyCreditPlanCatalogCurrencyToHkdMigration,
  CREDIT_PLAN_CATALOG_CURRENCY_MIGRATION_KEYS,
  type CreditPlanCatalogCurrencyMigrationKey,
  previewCreditPlanCatalogCurrencyToHkdMigration,
  rollbackCreditPlanCatalogCurrencyToHkdMigration,
} from './credit-plan-catalog-source.js';
import { PostgresAdminConfigRepository } from './postgres-repository.js';

export type CreditPlanCatalogMigrationCliCommand =
  | { action: 'dry-run' }
  | {
      action: 'apply';
      expectedRevision: number;
      key: CreditPlanCatalogCurrencyMigrationKey;
    }
  | {
      action: 'rollback';
      expectedRevision: number;
      key: CreditPlanCatalogCurrencyMigrationKey;
      targetRevision: number;
    }
  | { action: 'help' };

export const creditPlanCatalogMigrationCliUsage = `Usage:
  pnpm --filter @meiye/core plan-catalog:migrate -- dry-run
  pnpm --filter @meiye/core plan-catalog:migrate -- apply <key> <expected-revision>
  pnpm --filter @meiye/core plan-catalog:migrate -- rollback <key> <expected-revision> <target-revision>

Migration keys:
  ${CREDIT_PLAN_CATALOG_CURRENCY_MIGRATION_KEYS.join('\n  ')}

Required environment for apply and rollback:
  DATABASE_URL
  CREDIT_PLAN_CATALOG_MIGRATION_ADMIN_ID
  CREDIT_PLAN_CATALOG_MIGRATION_CORRELATION_ID`;

export function parseCreditPlanCatalogMigrationCliArguments(
  argv: string[]
): CreditPlanCatalogMigrationCliCommand {
  const [action, ...arguments_] = argv[0] === '--' ? argv.slice(1) : argv;
  if (!action || action === '--help' || action === '-h') {
    return { action: 'help' };
  }
  if (action === 'dry-run') {
    if (arguments_.length !== 0) {
      throw new Error('dry-run does not accept positional arguments.');
    }
    return { action };
  }
  if (action === 'apply') {
    const [key, expectedRevision, extra] = arguments_;
    if (extra !== undefined) {
      throw new Error('apply accepts exactly a key and expected revision.');
    }
    return {
      action,
      expectedRevision: requiredRevision(expectedRevision, 'expected revision'),
      key: migrationKey(key),
    };
  }
  if (action === 'rollback') {
    const [key, expectedRevision, targetRevision, extra] = arguments_;
    if (extra !== undefined) {
      throw new Error(
        'rollback accepts exactly a key, expected revision, and target revision.'
      );
    }
    return {
      action,
      expectedRevision: requiredRevision(expectedRevision, 'expected revision'),
      key: migrationKey(key),
      targetRevision: requiredRevision(targetRevision, 'target revision'),
    };
  }
  throw new Error(`Unknown credit plan migration action: ${action}`);
}

export async function runCreditPlanCatalogMigrationCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  const command = parseCreditPlanCatalogMigrationCliArguments(argv);
  if (command.action === 'help') {
    return { help: creditPlanCatalogMigrationCliUsage };
  }
  const pool = new Pool({
    connectionString: requiredEnvironment(env, 'DATABASE_URL'),
    max: 2,
  });
  try {
    const repository = new PostgresAdminConfigRepository(pool);
    if (command.action === 'dry-run') {
      return await previewCreditPlanCatalogCurrencyToHkdMigration(repository);
    }
    const actorId = requiredEnvironment(
      env,
      'CREDIT_PLAN_CATALOG_MIGRATION_ADMIN_ID'
    );
    const correlationId = requiredEnvironment(
      env,
      'CREDIT_PLAN_CATALOG_MIGRATION_CORRELATION_ID'
    );
    if (command.action === 'apply') {
      return await applyCreditPlanCatalogCurrencyToHkdMigration(repository, {
        actorId,
        correlationId,
        expectedRevision: command.expectedRevision,
        key: command.key,
      });
    }
    return await rollbackCreditPlanCatalogCurrencyToHkdMigration(repository, {
      actorId,
      correlationId,
      expectedRevision: command.expectedRevision,
      key: command.key,
      targetRevision: command.targetRevision,
    });
  } finally {
    await pool.end();
  }
}

function migrationKey(value: string | undefined) {
  if (
    !value ||
    !CREDIT_PLAN_CATALOG_CURRENCY_MIGRATION_KEYS.includes(
      value as CreditPlanCatalogCurrencyMigrationKey
    )
  ) {
    throw new Error(`Unknown migration key: ${value ?? '(missing)'}`);
  }
  return value as CreditPlanCatalogCurrencyMigrationKey;
}

function requiredRevision(value: string | undefined, label: string) {
  if (!value || !/^[1-9]\d*$/u.test(value)) {
    throw new Error(`A positive ${label} is required.`);
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new Error(`A safe ${label} is required.`);
  }
  return revision;
}

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
