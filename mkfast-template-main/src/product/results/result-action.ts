/**
 * ResultAction — single write owner for adopt / AI adjust / server export /
 * handoff (WORK-01 / R-P1-08).
 *
 * Works and Workbench only mint a typed ResultTarget. This module consumes
 * that target and names the exact Result revision/panel action. Only Result
 * executes the write (`result_export` / `result_adopt` / `result_adjust`).
 */

import type {
  ResultActionId,
  ResultExportCommand,
  ResultPanel,
  ResultTarget,
} from '@meiye/contracts';
import { resultCenterPath, resultCenterSearchParams } from '@meiye/contracts';

import {
  resultReturnSearch,
  type ResultReturnState,
} from './result-return-navigation';
import type { ResultCommandTransport } from './use-result-commands';

export type ResultWriteIntent = 'adopt' | 'adjust' | 'export' | 'handoff';

export type ResultActionRevision = {
  contentId: string;
  platform?: 'douyin' | 'video_account' | 'xiaohongshu' | null;
  revision: number;
  versionId: string;
  workId: string;
};

export type ResultActionWrite = {
  action: 'result_export';
  idempotencyKey: string;
  kind: 'result_export';
  module: 'result-delivery';
  payload: ResultExportCommand;
};

export type ResultActionIdentity = {
  actionId: ResultActionId;
  target: ResultTarget;
  writer: 'result';
};

export type ResultActionPlan = ResultActionIdentity & {
  href: string;
  intent: ResultWriteIntent;
  write: ResultActionWrite | null;
};

export const RESULT_WRITE_INTENT_PANEL = {
  adjust: 'adjust',
  adopt: 'result',
  export: 'delivery',
  handoff: 'delivery',
} as const satisfies Record<ResultWriteIntent, ResultPanel>;

export const RESULT_WRITE_INTENT_ACTION = {
  adjust: 'continue_adjust',
  adopt: 'adopt_candidate',
  export: 'deliver',
  handoff: 'deliver',
} as const satisfies Record<ResultWriteIntent, ResultActionId>;

export function resultActionTarget(
  revision: ResultActionRevision,
  intent: ResultWriteIntent
): ResultTarget {
  return {
    contentId: revision.contentId,
    panel: RESULT_WRITE_INTENT_PANEL[intent],
    versionId: revision.versionId,
    workId: revision.workId,
  };
}

export function resultActionHref(
  target: ResultTarget,
  returnState?: ResultReturnState
): string {
  const search: Record<string, number | string | undefined> = {
    ...resultCenterSearchParams(target),
    ...resultReturnSearch(returnState),
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query
    ? `${resultCenterPath(target.workId)}?${query}`
    : resultCenterPath(target.workId);
}

export function resultExportWrite(
  revision: ResultActionRevision
): ResultActionWrite | null {
  if (!revision.platform) return null;
  return {
    action: 'result_export',
    idempotencyKey: `export:${revision.contentId}:${revision.revision}:${revision.platform}`,
    kind: 'result_export',
    module: 'result-delivery',
    payload: {
      expectedRevision: revision.revision,
      packageId: revision.contentId,
      platform: revision.platform,
    },
  };
}

export function resultActionForRevision(
  revision: ResultActionRevision,
  intent: ResultWriteIntent,
  options?: { returnState?: ResultReturnState }
): ResultActionPlan {
  const target = resultActionTarget(revision, intent);
  return {
    actionId: RESULT_WRITE_INTENT_ACTION[intent],
    href: resultActionHref(target, options?.returnState),
    intent,
    target,
    write: intent === 'export' ? resultExportWrite(revision) : null,
    writer: 'result',
  };
}

export function resultActionIdentity(
  plan: ResultActionPlan
): ResultActionIdentity {
  return {
    actionId: plan.actionId,
    target: plan.target,
    writer: plan.writer,
  };
}

export async function executeResultActionWrite<T>(
  plan: ResultActionPlan,
  transport: ResultCommandTransport
): Promise<T> {
  if (plan.write?.kind !== 'result_export') {
    throw new Error('ResultAction has no Result write for this intent.');
  }
  return transport(
    plan.write.module,
    { action: plan.write.action, payload: plan.write.payload },
    plan.write.idempotencyKey
  ) as Promise<T>;
}
