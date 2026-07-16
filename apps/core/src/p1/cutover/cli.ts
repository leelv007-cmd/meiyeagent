import { Pool } from 'pg';
import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { P1CutoverExecutionService } from './execution-service.js';

const actions = [
  'plan',
  'inspect',
  'dry-run',
  'backup',
  'restore',
  'freeze',
  'backfill',
  'activate',
  'rollback',
] as const;

type CutoverCliAction = (typeof actions)[number];

export const cutoverCliUsage = `Usage:
  pnpm uiux:cutover plan
  pnpm uiux:cutover <inspect|dry-run|backup|restore|freeze|backfill|activate> <run-id>
  pnpm uiux:cutover rollback <run-id> <reason>

Required environment:
  DATABASE_URL
  CUTOVER_WORKSPACE_ID
  CUTOVER_ACTOR_ID
  CUTOVER_CORRELATION_ID`;

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function runCutoverCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  const requested = argv[0];
  if (!requested || requested === '--help' || requested === '-h') {
    return { help: cutoverCliUsage };
  }
  if (!actions.includes(requested as CutoverCliAction)) {
    throw new Error(`Unknown cutover action: ${requested}`);
  }
  const action = requested as CutoverCliAction;
  const databaseUrl = required(env, 'DATABASE_URL');
  const context = {
    actorId: required(env, 'CUTOVER_ACTOR_ID'),
    correlationId: required(env, 'CUTOVER_CORRELATION_ID'),
    workspaceId: required(env, 'CUTOVER_WORKSPACE_ID'),
  };
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const service = new P1CutoverExecutionService(pool);
    await migratePostgresSchema(pool, [service]);
    if (action === 'plan') return await service.plan(context);
    const runId = argv[1]?.trim();
    if (!runId) throw new Error(`A run id is required for ${action}.`);
    switch (action) {
      case 'inspect':
        return await service.inspect(context, runId);
      case 'dry-run':
        return await service.dryRun(context, runId);
      case 'backup':
        return await service.backup(context, runId);
      case 'restore':
        return await service.rehearseRestore(context, runId);
      case 'freeze':
        return await service.freeze(context, runId);
      case 'backfill':
        return await service.backfill(context, runId);
      case 'activate':
        return await service.activate(context, runId);
      case 'rollback': {
        const reason = argv.slice(2).join(' ').trim();
        if (!reason) throw new Error('A rollback reason is required.');
        return await service.rollbackFutureWrites(context, runId, reason);
      }
    }
  } finally {
    await pool.end();
  }
}
