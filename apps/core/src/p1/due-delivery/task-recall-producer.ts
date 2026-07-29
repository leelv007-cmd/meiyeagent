import type {
  EnqueueDueDeliveryInput,
  PostgresDueDeliveryRepository,
} from './postgres-repository.js';

export interface TaskRecallDueInput {
  completedAt: string;
  sourceTaskId: string;
  workspaceId: string;
}

export class TaskRecallDueProducer {
  constructor(
    private readonly due: Pick<PostgresDueDeliveryRepository, 'enqueue'>,
  ) {}

  produce(input: TaskRecallDueInput) {
    const workspaceId = input.workspaceId.trim();
    const sourceTaskId = input.sourceTaskId.trim();
    const completed = new Date(input.completedAt);
    if (!workspaceId || !sourceTaskId || Number.isNaN(completed.getTime())) {
      throw new Error('Task recall due input is invalid.');
    }
    const due: EnqueueDueDeliveryInput = {
      dueAt: completed.toISOString(),
      payload: {
        nextStep: '回到任务查看已完成内容',
        schemaVersion: 'task-recall/v1',
        taskId: sourceTaskId,
        title: '你的内容已完成',
      },
      taskId: `task-recall_${workspaceId}_${sourceTaskId}`,
      type: 'task_recall',
      workspaceId,
    };
    return this.due.enqueue(due);
  }
}
