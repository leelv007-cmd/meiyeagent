import { Pool } from 'pg';
import { PostgresRelationalProductRepository } from '../../product/relational-product-repository.js';
import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { fileSystemAssetStorageFromEnv } from '../model-supply/filesystem-asset-storage.js';
import {
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './adapters.js';
import { OperationsApplicationService } from './application-service.js';
import {
  ContentPackageMigrationService,
  HeadGetContentPackageOwnedReceiptVerifier,
  PostgresContentPackageMigrationRunRepository,
  PostgresContentPackageMigrationSource,
} from './content-package-migration.js';
import { PostgresContentPackageWriteOwnership } from './content-package-write-ownership.js';
import { OperationsFoundationModule } from './foundation-module.js';
import { PostgresOperationsRepository } from './postgres-repository.js';

const actions = [
  'inspect',
  'dry-run',
  'freeze',
  'backfill',
  'activate',
  'rollback',
  'status',
  'report',
] as const;

type ContentPackageMigrationCliAction = (typeof actions)[number];

export const contentPackageMigrationCliUsage = `Usage:
  pnpm contentpackage:cutover <inspect|dry-run|freeze|backfill|activate|rollback|status|report> <run-id>

Required environment:
  DATABASE_URL
  CONTENTPACKAGE_CUTOVER_WORKSPACE_ID
  CONTENTPACKAGE_CUTOVER_ADMIN_ID
  CONTENTPACKAGE_CUTOVER_CORRELATION_ID`;

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function runContentPackageMigrationCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  const requested = argv[0];
  if (!requested || requested === '--help' || requested === '-h') {
    return { help: contentPackageMigrationCliUsage };
  }
  if (!actions.includes(requested as ContentPackageMigrationCliAction)) {
    throw new Error(`Unknown ContentPackage cutover action: ${requested}`);
  }
  const runId = argv[1]?.trim();
  if (!runId) throw new Error(`A run id is required for ${requested}.`);
  const workspaceId = required(env, 'CONTENTPACKAGE_CUTOVER_WORKSPACE_ID');
  const adminId = required(env, 'CONTENTPACKAGE_CUTOVER_ADMIN_ID');
  const correlationId = required(env, 'CONTENTPACKAGE_CUTOVER_CORRELATION_ID');
  const pool = new Pool({
    connectionString: required(env, 'DATABASE_URL'),
    max: 2,
  });
  try {
    const operations = new PostgresOperationsRepository(pool);
    const product = new PostgresRelationalProductRepository(pool);
    const ownership = new PostgresContentPackageWriteOwnership(pool);
    const runs = new PostgresContentPackageMigrationRunRepository(pool);
    const assetStorage = fileSystemAssetStorageFromEnv(env);
    await migratePostgresSchema(pool, [operations, product, ownership, runs]);
    const service = new ContentPackageMigrationService({
      ownedReceiptVerifier: new HeadGetContentPackageOwnedReceiptVerifier({
        async get(objectKey) {
          return (await assetStorage.read(objectKey)).bytes;
        },
        async head(objectKey) {
          try {
            const stored = await assetStorage.read(objectKey);
            return {
              contentType: stored.contentType,
              sizeBytes: stored.bytes.byteLength,
            };
          } catch {
            return null;
          }
        },
      }),
      ownership,
      repository: operations,
      runs,
      source: new PostgresContentPackageMigrationSource({
        operations,
        pool,
        product,
      }),
    });
    const module = new OperationsFoundationModule(
      new OperationsApplicationService(operations, {
        canvasExporter: new RecordedCanvasExportAdapter(),
        contentPackageMigration: service,
        imageGenerator: new RecordedImageGenerationAdapter(),
        notifier: { async send() {} },
      }),
      { adminActorIds: [adminId] }
    );
    const context = { correlationId, userId: adminId, workspaceId };
    if (requested === 'status' || requested === 'report') {
      return await module.query({
        context,
        input: {
          action: `content_package_migration_${requested}`,
          payload: { runId },
        },
      });
    }
    return await module.execute({
      context,
      idempotencyKey: `content-package-migration:${requested}:${runId}`,
      input: {
        action: `content_package_migration_${requested.replace('-', '_')}`,
        payload: { runId },
      },
    });
  } finally {
    await pool.end();
  }
}
