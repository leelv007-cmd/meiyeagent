import type { OperationsApplicationService } from '../operations/application-service.js';
import type {
  ConfirmationTaskPort,
  IntegrationAnomalyTaskPort,
} from './contracts.js';

/**
 * Bridges integration confirmations and connection anomalies to the durable
 * operations task store. Synthetic identifiers never count as confirmation.
 */
export class OperationsConfirmationTaskAdapter
  implements ConfirmationTaskPort, IntegrationAnomalyTaskPort
{
  constructor(private readonly operations: OperationsApplicationService) {}

  async create(input: Parameters<ConfirmationTaskPort['create']>[0]) {
    const task = await this.operations.createTask(
      {
        actor: 'worker',
        correlationId: input.correlationId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      },
      {
        blockedReason: '需要 Owner 确认后才能执行外部高风险操作',
        dedupeKey: `feishu-confirmation:${input.intentId}`,
        dueAt: input.dueAt,
        executable: false,
        nextStep: '打开任务并确认不可变的飞书操作意图',
        relatedObject: { id: input.intentId, kind: 'integration' },
        risk: 'external_permission',
        source: 'manual',
        title: input.title,
      }
    );
    return { taskId: task.id };
  }

  async confirm(input: Parameters<ConfirmationTaskPort['confirm']>[0]) {
    await this.operations.transitionTask(
      {
        actor: 'worker',
        correlationId: input.correlationId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      },
      input.taskId,
      'done',
      `feishu_intent_confirmed:${input.intentId}`
    );
  }

  async report(input: Parameters<IntegrationAnomalyTaskPort['report']>[0]) {
    const task = await this.operations.createTask(
      {
        actor: 'worker',
        correlationId: input.correlationId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      },
      {
        blockedReason: input.reason,
        dedupeKey: `integration-anomaly:${input.connectionId}`,
        dueAt: new Date().toISOString(),
        executable: false,
        nextStep:
          input.status === 'rate_limited'
            ? '稍后重试并确认连接恢复'
            : '打开集成设置重新授权或检查权限',
        relatedObject: { id: input.connectionId, kind: 'integration' },
        risk: 'external_permission',
        source: 'manual',
        title: `处理 ${input.provider} 连接异常`,
      }
    );
    return { taskId: task.id };
  }

  async resolve(input: Parameters<IntegrationAnomalyTaskPort['resolve']>[0]) {
    const context = {
      actor: 'worker' as const,
      correlationId: input.correlationId,
      userId: input.userId,
      workspaceId: input.workspaceId,
    };
    const inbox = await this.operations.listInbox(context, {
      relatedObject: { id: input.connectionId, kind: 'integration' },
    });
    const active = inbox.tasks.filter(
      (task) =>
        task.dedupeKey === `integration-anomaly:${input.connectionId}` &&
        task.status !== 'archived'
    );
    for (const task of active) {
      await this.operations.transitionTask(
        context,
        task.id,
        'archived',
        'integration_connection_recovered'
      );
    }
  }
}
