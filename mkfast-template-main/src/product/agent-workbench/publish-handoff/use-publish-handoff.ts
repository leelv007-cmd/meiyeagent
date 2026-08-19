/**
 * V31-17 production hook: prepare MobilePublishHandoff after Delivered and
 * wire merchant published / self-report actions through P1 operations.
 */

import type {
  OutcomeSelfReportChipSignal,
  PublishHandoffView,
  SelfReportAskDecision,
} from '@meiye/contracts';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { commandP1, operationsQuery, queryP1 } from '@/p1/client';

import { exportAndDownloadFullPackage } from './export-full-package-download';
import {
  panelViewFromPublishHandoff,
  type PublishHandoffPanelView,
} from './publish-handoff-model';

export type UsePublishHandoffInput = {
  accountId?: string | null;
  workspaceId?: string | null;
  threadId?: string | null;
  /** Composer session phase — prepare handoff materials only when delivered. */
  phase: string | null | undefined;
  packageId?: string | null;
  platform?: string | null;
  variantVersionId?: string | null;
  workId?: string | null;
  /** When true, skip network (tests). */
  enabled?: boolean;
};

export type UsePublishHandoffResult = {
  publishHandoffError: string | null;
  publishHandoffView: PublishHandoffPanelView | null;
  selfReportPrompt: string | null;
  selfReportChips: readonly OutcomeSelfReportChipSignal[] | undefined;
  onPublishHandoffCopy: (role: string, value: string) => void;
  onPublishHandoffDownloadZip: (fileName: string) => Promise<void>;
  onPublishHandoffRecordPublished: (input: {
    contentPackageId: string;
    contentPackageRevision: number;
    platformUrl?: string;
    note?: string;
  }) => Promise<void>;
  onSelfReportChip: (signal: OutcomeSelfReportChipSignal) => Promise<void>;
  onSelfReportIgnore: () => Promise<void>;
};

type PublishHandoffState = {
  identityKey: string | null;
  publishHandoffError: string | null;
  selfReport: SelfReportAskDecision | null;
  view: PublishHandoffPanelView | null;
};

type PublishHandoffStateAction =
  | { type: 'bind_identity'; identityKey: string | null }
  | { type: 'clear'; identityKey: string }
  | {
      type: 'set_error';
      identityKey: string;
      error: string;
    }
  | {
      type: 'set_self_report';
      identityKey: string;
      selfReport: SelfReportAskDecision;
    }
  | {
      type: 'set_view';
      identityKey: string;
      view: PublishHandoffPanelView;
    };

function emptyHandoffState(identityKey: string | null): PublishHandoffState {
  return {
    identityKey,
    publishHandoffError: null,
    selfReport: null,
    view: null,
  };
}

function reduceHandoffState(
  state: PublishHandoffState,
  action: PublishHandoffStateAction
): PublishHandoffState {
  if (action.type === 'bind_identity') {
    return emptyHandoffState(action.identityKey);
  }
  if (state.identityKey !== action.identityKey) return state;
  switch (action.type) {
    case 'clear':
      return emptyHandoffState(action.identityKey);
    case 'set_error':
      return { ...state, publishHandoffError: action.error };
    case 'set_self_report':
      return { ...state, selfReport: action.selfReport };
    case 'set_view':
      return { ...state, view: action.view };
  }
}

export function usePublishHandoff(
  input: UsePublishHandoffInput
): UsePublishHandoffResult {
  const enabled = input.enabled !== false;
  const [state, dispatch] = useReducer(
    reduceHandoffState,
    null,
    emptyHandoffState
  );
  const handoffPreparedKeyRef = useRef<string | null>(null);
  const selfReportHydratedKeyRef = useRef<string | null>(null);
  const askIdRef = useRef<string | null>(null);
  const variantVersionIdRef = useRef<string | null>(null);
  const askedPackageRef = useRef<{ id: string; revision: number } | null>(null);

  const packageId = input.packageId ?? null;
  const platform = input.platform ?? 'xiaohongshu';
  const variantVersionId = input.variantVersionId ?? null;
  const workId = input.workId ?? null;
  const phase = input.phase ?? null;
  const identityKey =
    enabled && phase === 'delivered' && packageId && workId
      ? [
          input.accountId ?? '',
          input.workspaceId ?? '',
          input.threadId ?? '',
          packageId,
          workId,
          platform,
          variantVersionId ?? '',
        ].join(':')
      : null;

  const stateMatchesIdentity = Boolean(
    identityKey && state.identityKey === identityKey
  );
  const view = stateMatchesIdentity ? state.view : null;
  const publishHandoffError = stateMatchesIdentity
    ? state.publishHandoffError
    : null;
  const selfReport = stateMatchesIdentity ? state.selfReport : null;

  useLayoutEffect(() => {
    handoffPreparedKeyRef.current = null;
    selfReportHydratedKeyRef.current = null;
    askIdRef.current = null;
    variantVersionIdRef.current = null;
    askedPackageRef.current = null;
    dispatch({ type: 'bind_identity', identityKey });
  }, [identityKey]);

  useEffect(() => {
    if (!enabled || !identityKey || !packageId || !workId) return;
    let cancelled = false;

    void (async () => {
      try {
        const packages = await operationsQuery<
          Array<{
            id: string;
            revision: number;
            variants?: Array<{
              platform: string;
              currentVersionId: string;
            }>;
            versions?: Array<{ id: string }>;
            currentVersionId?: string;
          }>
        >('content_packages', {});
        if (cancelled) return;
        const matched = packages.find((item) => item.id === packageId);
        if (!matched) return;
        const resolvedVariant =
          variantVersionId ??
          matched.variants?.find((row) => row.platform === platform)
            ?.currentVersionId ??
          matched.currentVersionId ??
          matched.versions?.[0]?.id;
        if (!resolvedVariant) return;
        const prepareKey = [
          packageId,
          matched.revision,
          resolvedVariant,
          'delivered',
        ].join(':');
        if (handoffPreparedKeyRef.current === prepareKey) return;
        selfReportHydratedKeyRef.current = null;
        askedPackageRef.current = null;
        dispatch({ type: 'clear', identityKey });
        variantVersionIdRef.current = resolvedVariant;
        const prepared = await commandP1<PublishHandoffView>(
          'operations',
          {
            action: 'prepare_mobile_publish_handoff',
            payload: {
              packageId,
              expectedRevision: matched.revision,
              platform,
              variantVersionId: resolvedVariant,
              workId,
            },
          },
          `prepare-mobile-publish-handoff:${prepareKey}`
        );
        if (cancelled) return;
        const panel = panelViewFromPublishHandoff(prepared);
        handoffPreparedKeyRef.current = prepareKey;
        askedPackageRef.current = {
          id: panel.contentPackageId,
          revision: panel.publicationBindingRevision,
        };
        dispatch({ type: 'set_view', identityKey, view: panel });
      } catch {
        if (cancelled) return;
        dispatch({
          type: 'set_error',
          identityKey,
          error: '手机交接暂未准备好，请刷新后重试，或前往结果中心完成交接。',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, identityKey, packageId, platform, variantVersionId, workId]);

  useEffect(() => {
    if (!enabled || !identityKey || !packageId || !workId) return;
    if (!view) return;
    const canonicalRevision = view?.publicationBindingRevision;
    const askKey = `${workId}:${packageId}:${platform}:${variantVersionId ?? ''}:${canonicalRevision ?? 'server'}`;
    if (selfReportHydratedKeyRef.current === askKey) return;
    let cancelled = false;

    void (async () => {
      try {
        const packages = await operationsQuery<
          Array<{
            id: string;
            revision: number;
            variants?: Array<{
              platform: string;
              currentVersionId: string;
            }>;
            versions?: Array<{ id: string }>;
            currentVersionId?: string;
          }>
        >('content_packages', {});
        if (cancelled) return;
        const matched = packages.find((item) => item.id === packageId);
        if (!matched) return;
        const resolvedVariant =
          variantVersionId ??
          matched.variants?.find((row) => row.platform === platform)
            ?.currentVersionId ??
          matched.currentVersionId ??
          matched.versions?.[0]?.id;
        if (!resolvedVariant) return;
        variantVersionIdRef.current = resolvedVariant;
        const currentRevision = canonicalRevision ?? matched.revision;
        askedPackageRef.current = {
          id: matched.id,
          revision: currentRevision,
        };

        const decision = await queryP1<SelfReportAskDecision>('operations', {
          action: 'self_report_ask',
          payload: {
            workId,
            contentPackageId: packageId,
            platform,
            variantVersionId: resolvedVariant,
          },
        });
        if (cancelled) return;
        selfReportHydratedKeyRef.current = askKey;
        dispatch({
          type: 'set_self_report',
          identityKey,
          selfReport: decision,
        });
        if (decision.kind === 'ask') {
          const ask = await commandP1<{ askId: string }>(
            'operations',
            {
              action: 'record_self_report_ask',
              payload: {
                workId,
                contentPackageId: packageId,
                contentPackageRevision: currentRevision,
                action: 'mark_asked',
              },
            },
            `self-report-ask:${workId}`
          );
          askIdRef.current = ask.askId;
        }
      } catch {
        // Fail closed: leave panel unset; merchant still has result-center path.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    identityKey,
    packageId,
    platform,
    variantVersionId,
    view,
    workId,
  ]);

  const onPublishHandoffCopy = useCallback((role: string, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).catch(() => {
        /* ignore */
      });
    }
    void role;
  }, []);

  const onPublishHandoffDownloadZip = useCallback(
    async (fileName: string) => {
      if (!view) {
        throw new Error('Publish handoff materials are not ready.');
      }
      // Same channel as result-center full_package (result_export → asset URL).
      await exportAndDownloadFullPackage({
        packageId: view.contentPackageId,
        expectedRevision: view.publicationBindingRevision,
        platform: view.platform || platform,
        fileName,
        transport: commandP1,
      });
    },
    [platform, view]
  );

  const onPublishHandoffRecordPublished = useCallback(
    async (record: {
      contentPackageId: string;
      contentPackageRevision: number;
      platformUrl?: string;
      note?: string;
    }) => {
      if (!identityKey) {
        throw new Error('Publish handoff materials are not ready.');
      }
      const resolvedVariant = variantVersionIdRef.current ?? variantVersionId;
      if (!resolvedVariant) {
        throw new Error('Publish handoff variant is not prepared yet.');
      }
      const updated = await commandP1<{ id: string; revision: number }>(
        'operations',
        {
          action: 'record_merchant_published',
          payload: {
            packageId: record.contentPackageId,
            expectedRevision: record.contentPackageRevision,
            platform,
            variantVersionId: resolvedVariant,
            ...(record.platformUrl ? { platformUrl: record.platformUrl } : {}),
            ...(record.note ? { note: record.note } : {}),
            ...(workId ? { workId } : {}),
          },
        },
        `merchant-published:${record.contentPackageId}:${record.contentPackageRevision}`
      );
      askedPackageRef.current = {
        id: updated.id,
        revision: updated.revision,
      };
      if (workId) {
        try {
          const decision = await queryP1<SelfReportAskDecision>('operations', {
            action: 'self_report_ask',
            payload: {
              workId,
              contentPackageId: record.contentPackageId,
              platform,
              variantVersionId: resolvedVariant,
            },
          });
          dispatch({
            type: 'set_self_report',
            identityKey,
            selfReport: decision,
          });
        } catch {
          /* observation only */
        }
      }
    },
    [identityKey, platform, variantVersionId, workId]
  );

  const onSelfReportChip = useCallback(
    async (signal: OutcomeSelfReportChipSignal) => {
      const askedPackage = askedPackageRef.current;
      if (!identityKey || !askedPackage || !workId) return;
      await commandP1(
        'operations',
        {
          action: 'record_content_package_result_signal',
          payload: {
            packageId: askedPackage.id,
            expectedRevision: askedPackage.revision,
            kind: mapChipToResultKind(signal),
            sourceRef: `chip:${signal}`,
          },
        },
        `self-report-signal:${askedPackage.id}:${signal}`
      );
      await commandP1(
        'operations',
        {
          action: 'record_self_report_ask',
          payload: {
            workId,
            contentPackageId: askedPackage.id,
            contentPackageRevision: askedPackage.revision,
            action: 'mark_answered',
            ...(askIdRef.current ? { askId: askIdRef.current } : {}),
          },
        },
        `self-report-answered:${workId}`
      );
      dispatch({
        type: 'set_self_report',
        identityKey,
        selfReport: { kind: 'skip', reason: 'already_answered' },
      });
    },
    [identityKey, workId]
  );

  const onSelfReportIgnore = useCallback(async () => {
    const askedPackage = identityKey ? askedPackageRef.current : null;
    if (!askedPackage || !workId) return;
    await commandP1(
      'operations',
      {
        action: 'record_self_report_ask',
        payload: {
          workId,
          contentPackageId: askedPackage.id,
          contentPackageRevision: askedPackage.revision,
          action: 'mark_ignored',
          ...(askIdRef.current ? { askId: askIdRef.current } : {}),
        },
      },
      `self-report-ignored:${workId}`
    );
    if (identityKey) {
      dispatch({
        type: 'set_self_report',
        identityKey,
        selfReport: { kind: 'skip', reason: 'already_asked_this_work' },
      });
    }
  }, [identityKey, workId]);

  const selfReportPrompt =
    selfReport?.kind === 'ask' ? selfReport.prompt : null;
  const selfReportChips =
    selfReport?.kind === 'ask' ? selfReport.chips : undefined;

  return useMemo(
    () => ({
      publishHandoffError,
      publishHandoffView: view,
      selfReportPrompt,
      selfReportChips,
      onPublishHandoffCopy,
      onPublishHandoffDownloadZip,
      onPublishHandoffRecordPublished,
      onSelfReportChip,
      onSelfReportIgnore,
    }),
    [
      view,
      publishHandoffError,
      selfReportPrompt,
      selfReportChips,
      onPublishHandoffCopy,
      onPublishHandoffDownloadZip,
      onPublishHandoffRecordPublished,
      onSelfReportChip,
      onSelfReportIgnore,
    ]
  );
}

function mapChipToResultKind(signal: OutcomeSelfReportChipSignal): string {
  switch (signal) {
    case 'inquiry':
      return 'inquiry';
    case 'wechat':
      return 'wechat_added';
    case 'booking':
      return 'appointment';
    case 'purchase':
      return 'voucher_purchase';
    case 'visit':
      return 'store_visit';
    case 'no_activity':
      return 'no_activity';
  }
}
