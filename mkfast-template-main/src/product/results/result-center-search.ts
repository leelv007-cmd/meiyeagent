import {
  DEEP_LINK_STAGE_TO_PANEL,
  parseDeepLinkEntry,
  parseDeepLinkStage,
  type DeepLinkEntry,
  type DeepLinkStage,
} from '@/product/canonical-deep-link';
import {
  resultPanels,
  type ResultPanel,
} from '@meiye/contracts/result-center-navigation';

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
  stage?: DeepLinkStage;
  entry?: DeepLinkEntry;
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
export function parseResultCenterSearch(
  search: Record<string, unknown>
): ResultCenterSearch {
  const contentId = optionalString(search.contentId);
  const versionId = optionalString(search.versionId);
  const taskId = optionalString(search.taskId);
  const stage = parseDeepLinkStage(search.stage);
  const entry = parseDeepLinkEntry(search.entry);
  const panel =
    optionalPanel(search.panel) ??
    (stage ? DEEP_LINK_STAGE_TO_PANEL[stage] : undefined);
  const focusKey = optionalString(search.focusKey);
  const returnState = parseResultReturnState(search);

  return {
    ...(contentId ? { contentId } : {}),
    ...(versionId ? { versionId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(panel ? { panel } : {}),
    ...(focusKey ? { focusKey } : {}),
    ...(stage ? { stage } : {}),
    ...(entry ? { entry } : {}),
    ...resultReturnSearch(returnState),
  };
}
