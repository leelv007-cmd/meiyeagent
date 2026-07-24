import type { ResultPanel } from '@meiye/contracts';
import { resultPanels } from '@meiye/contracts';

import {
  parseResultReturnState,
  resultReturnSearch,
  type ResultReturnSearch,
} from './result-return-navigation';

export type ResultCenterSearch = {
  contentId?: string;
  versionId?: string;
  taskId?: string;
  panel?: ResultPanel;
  focusKey?: string;
} & ResultReturnSearch;

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalPanel(value: unknown): ResultPanel | undefined {
  return typeof value === 'string' &&
    (resultPanels as readonly string[]).includes(value)
    ? (value as ResultPanel)
    : undefined;
}

/** The Result route keeps only its public target and trusted return anchor. */
export function validateResultCenterSearch(
  search: Record<string, unknown>
): ResultCenterSearch {
  const contentId = optionalString(search.contentId);
  const versionId = optionalString(search.versionId);
  const taskId = optionalString(search.taskId);
  const panel = optionalPanel(search.panel);
  const focusKey = optionalString(search.focusKey);
  const returnState = parseResultReturnState(search);

  return {
    ...(contentId ? { contentId } : {}),
    ...(versionId ? { versionId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(panel ? { panel } : {}),
    ...(focusKey ? { focusKey } : {}),
    ...resultReturnSearch(returnState),
  };
}
