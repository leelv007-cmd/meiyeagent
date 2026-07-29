import {
  harnessActiveTaskListSchema,
  harnessTaskSubmissionSchema,
  harnessDecisionSnapshotSchema,
  harnessDecisionSubmitResultSchema,
  harnessInteractionAnswerSchema,
  harnessInteractionRequestSchema,
  firstUsableDraftMetricSchema,
  structuredDecisionInputSchema,
  todayRecommendationStateSchema,
  type ApiEnvelope,
  type HarnessTaskSubmission,
  type FirstUsableDraftMetric,
  type HarnessDecisionSnapshot as HarnessDecisionReadModel,
  type HarnessInteractionAnswer,
  type StructuredDecisionInput,
} from '@meiye/contracts';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { P1RequestError } from '@/p1/client';

const taskHandleSchema = z
  .object({
    workflowId: z.string().trim().min(1),
    replayed: z.boolean(),
  })
  .strict();

export interface HarnessDecisionSnapshot extends HarnessDecisionReadModel {
  exists: boolean;
}

export async function readHarnessDecisionSnapshot(
  response: Response
): Promise<HarnessDecisionSnapshot> {
  if (response.status === 404) {
    return {
      exists: false,
      question: null,
      resolutionSource: null,
      status: 'absent',
      timeoutSeconds: null,
    };
  }
  return {
    exists: true,
    ...harnessDecisionSnapshotSchema.parse(
      await readEnvelope<unknown>(response)
    ),
  };
}

export async function readHarnessSubmitResult(response: Response) {
  return harnessDecisionSubmitResultSchema.parse(
    await readEnvelope<unknown>(response)
  );
}

export async function submitHarnessTask(input: HarnessTaskSubmission) {
  const request = harnessTaskSubmissionSchema.parse(input);
  const response = await telemetryFetch('/api/core/p1/harness/tasks', {
    body: JSON.stringify(request),
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': request.taskId,
    },
    method: 'POST',
  });
  return taskHandleSchema.parse(await readEnvelope<unknown>(response));
}

/**
 * 时间桥 (D-145). What is still running for this workspace, straight from the
 * server. Asked on composer mount so a closed tab is no longer a lost run —
 * the browser handle stops being the only way back in.
 */
export async function readActiveHarnessTasks(signal?: AbortSignal) {
  const response = await telemetryFetch('/api/core/p1/harness/tasks', {
    credentials: 'same-origin',
    signal,
  });
  return harnessActiveTaskListSchema.parse(
    await readEnvelope<unknown>(response)
  );
}

export async function readPendingHarnessDecision(
  taskId: string,
  signal?: AbortSignal
) {
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/decision`,
    { credentials: 'same-origin', signal }
  );
  return readHarnessDecisionSnapshot(response);
}

export async function submitHarnessDecision(
  taskId: string,
  input: StructuredDecisionInput
) {
  const command = structuredDecisionInputSchema.parse(input);
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/decision`,
    {
      body: JSON.stringify(command),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': command.idempotencyKey,
      },
      method: 'POST',
    }
  );
  return readHarnessSubmitResult(response);
}

export async function readPendingHarnessInteraction(
  taskId: string,
  signal?: AbortSignal
) {
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction`,
    { credentials: 'same-origin', signal }
  );
  return harnessInteractionRequestSchema
    .nullable()
    .parse(await readEnvelope<unknown>(response));
}

export async function submitHarnessInteraction(
  taskId: string,
  input: HarnessInteractionAnswer
) {
  const answer = harnessInteractionAnswerSchema.parse(input);
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction`,
    {
      body: JSON.stringify(answer),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': answer.idempotencyKey,
      },
      method: 'POST',
    }
  );
  return readEnvelope<unknown>(response);
}

export async function readPendingHarnessInteractionMessage(
  taskId: string,
  signal?: AbortSignal
) {
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction/message`,
    { credentials: 'same-origin', signal }
  );
  return harnessInteractionRequestSchema
    .nullable()
    .parse(await readEnvelope<unknown>(response));
}

export async function submitHarnessInteractionMerchantMessage(
  taskId: string,
  input: { idempotencyKey: string; message: string }
) {
  const message = z
    .object({
      idempotencyKey: z.string().trim().min(1),
      message: z.string().trim().min(1).max(2_000),
    })
    .strict()
    .parse(input);
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction/message`,
    {
      body: JSON.stringify(message),
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      method: 'POST',
    }
  );
  return readEnvelope<unknown>(response);
}

export async function setHarnessInteractionEditing(
  taskId: string,
  editing: boolean
) {
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction/editing`,
    {
      body: JSON.stringify({ editing }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  if (!response.ok) {
    await readEnvelope<unknown>(response);
  }
}

export async function acknowledgeHarnessInteractionRenderer(taskId: string) {
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/interaction/renderer`,
    {
      credentials: 'same-origin',
      method: 'POST',
    }
  );
  if (!response.ok) {
    await readEnvelope<unknown>(response);
  }
}

export async function recordFirstUsableDraftMetric(
  taskId: string,
  input: FirstUsableDraftMetric
) {
  const metric = firstUsableDraftMetricSchema.parse(input);
  const response = await telemetryFetch(
    `/api/core/p1/harness/tasks/${encodeURIComponent(taskId)}/product-metrics`,
    {
      body: JSON.stringify(metric),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  return readEnvelope<{ recorded: true }>(response);
}

export async function readTodayRecommendation(signal?: AbortSignal) {
  const response = await telemetryFetch('/api/core/p1/harness/recommendation', {
    credentials: 'same-origin',
    signal,
  });
  return todayRecommendationStateSchema.parse(
    await readEnvelope<unknown>(response)
  );
}

async function readEnvelope<T>(response: Response): Promise<T> {
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new P1RequestError('Harness response was not valid JSON.');
  }
  if (!response.ok || 'error' in envelope) {
    const error = 'error' in envelope ? envelope.error : undefined;
    throw new P1RequestError(
      error?.message ?? 'Harness request failed.',
      error?.code,
      error?.details
    );
  }
  return envelope.data;
}
