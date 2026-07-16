import type {
  JobRuntimeHandler,
  RecurringJobInput,
} from '../job-runtime/index.js';
import type {
  FeishuRemoteTool,
  IntegrationContext,
} from './contracts.js';

export const FEISHU_TOOL_LIFECYCLE_JOB_KIND =
  'integrations.feishu-tool-lifecycle';
export const FEISHU_TOOL_LIFECYCLE_SCHEDULE_ID =
  'integrations.feishu-tool-lifecycle.v1';

export interface FeishuToolLifecycleSummary {
  connectionCount: number;
  failedConnectionCount: number;
  incompatibleToolCount: number;
  publishedRevisionCount: number;
}

export interface FeishuToolLifecycleRunner {
  runFeishuToolLifecycle(
    context: IntegrationContext
  ): Promise<FeishuToolLifecycleSummary>;
}

export interface FeishuToolLifecycleSchedulePort {
  scheduleRecurring(input: RecurringJobInput): Promise<void>;
}

export interface VendoredFeishuTool {
  compatibility: {
    checkedAt: string;
    reason?: string;
    status: 'compatible' | 'incompatible';
  };
  inputSchema: Record<string, unknown>;
}

const schemaAnnotations = new Set([
  '$comment',
  'default',
  'description',
  'examples',
  'title',
]);

export function vendorFeishuTool(
  tool: FeishuRemoteTool,
  checkedAt = new Date().toISOString()
): VendoredFeishuTool {
  const inputSchema = isRecord(tool.inputSchema)
    ? stripSchemaAnnotations(tool.inputSchema)
    : {};
  const reason = incompatibilityReason(tool);
  return {
    compatibility: {
      checkedAt,
      ...(reason ? { reason } : {}),
      status: reason ? 'incompatible' : 'compatible',
    },
    inputSchema,
  };
}

function incompatibilityReason(tool: FeishuRemoteTool) {
  if (typeof tool.id !== 'string' || !tool.id.trim()) return 'tool_id_missing';
  if (
    typeof tool.remoteRevision !== 'string' ||
    !tool.remoteRevision.trim()
  ) {
    return 'remote_revision_missing';
  }
  if (
    !['read', 'write', 'destructive', 'open_world'].includes(String(tool.risk))
  ) {
    return 'tool_risk_invalid';
  }
  if (!isRecord(tool.inputSchema)) return 'schema_must_be_object';
  if (
    tool.inputSchema.type !== undefined &&
    tool.inputSchema.type !== 'object'
  ) {
    return 'schema_root_must_be_object';
  }
  if (
    tool.inputSchema.properties !== undefined &&
    !isRecord(tool.inputSchema.properties)
  ) {
    return 'schema_properties_must_be_object';
  }
  if (
    tool.inputSchema.required !== undefined &&
    (!Array.isArray(tool.inputSchema.required) ||
      tool.inputSchema.required.some(
        (key) => typeof key !== 'string' || !key.trim()
      ))
  ) {
    return 'schema_required_must_be_string_array';
  }
  const properties = isRecord(tool.inputSchema.properties)
    ? tool.inputSchema.properties
    : undefined;
  if (
    properties &&
    Array.isArray(tool.inputSchema.required) &&
    tool.inputSchema.required.some((key) => !(String(key) in properties))
  ) {
    return 'schema_required_property_missing';
  }
  return undefined;
}

function stripSchemaAnnotations(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (schemaAnnotations.has(key) || key.startsWith('x-')) return [];
      if (key === 'properties' && isRecord(entry)) {
        return [
          [
            key,
            Object.fromEntries(
              Object.entries(entry).map(([property, definition]) => [
                property,
                isRecord(definition)
                  ? stripSchemaAnnotations(definition)
                  : definition,
              ])
            ),
          ],
        ];
      }
      if (Array.isArray(entry)) {
        return [
          [
            key,
            entry.map((item) =>
              isRecord(item) ? stripSchemaAnnotations(item) : item
            ),
          ],
        ];
      }
      return [
        [key, isRecord(entry) ? stripSchemaAnnotations(entry) : entry],
      ];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createFeishuToolLifecycleJobHandler(
  lifecycle: FeishuToolLifecycleRunner
): JobRuntimeHandler {
  return async (envelope, worker) => {
    if (envelope.kind !== FEISHU_TOOL_LIFECYCLE_JOB_KIND) {
      return {
        output: { code: 'UNSUPPORTED_JOB_KIND' },
        status: 'dead_letter',
      };
    }
    try {
      const result = await lifecycle.runFeishuToolLifecycle({
        correlationId: `${envelope.jobId}:${worker.transportId}`,
        role: 'worker',
        userId: 'feishu-tool-lifecycle-worker',
        workspaceId: '__system__',
      });
      return { output: { ...result }, status: 'completed' };
    } catch (error) {
      return {
        output: {
          code: 'FEISHU_TOOL_LIFECYCLE_FAILED',
          message:
            error instanceof Error ? error.message : 'Unknown lifecycle error.',
        },
        status: 'retry',
      };
    }
  };
}

export function registerFeishuToolLifecycleSchedule(
  runtime: FeishuToolLifecycleSchedulePort,
  options: { cron?: string; timezone?: string } = {}
) {
  return runtime.scheduleRecurring({
    cron: options.cron ?? '*/15 * * * *',
    kind: FEISHU_TOOL_LIFECYCLE_JOB_KIND,
    payload: {},
    scheduleId: FEISHU_TOOL_LIFECYCLE_SCHEDULE_ID,
    timezone: options.timezone ?? 'Asia/Shanghai',
    workspaceId: '__system__',
  });
}
