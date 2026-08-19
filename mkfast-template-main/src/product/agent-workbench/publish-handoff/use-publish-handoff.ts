/**
 * V31-17 production hook: prepare MobilePublishHandoff after Delivered and
 * wire merchant published / self-report actions through P1 operations.
 */

import type {
  OutcomeSelfReportChipSignal,
  PublishHandoffView,
  SelfReportAskDecision,
} from '@meiye/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

export function usePublishHandoff(
  input: UsePublishHandoffInput
): UsePublishHandoffResult {
  const enabled = input.enabled !== false;
  const [view, setView] = useState<PublishHandoffPanelView | null>(null);
  const [publishHandoffError, setPublishHandoffError] = useState<string | null>(
    null
  );
  const [selfReport, setSelfReport] = useState<SelfReportAskDecision | null>(
    null
  );
  const viewIdentityKeyRef = useRef<string | null>(null);
  const errorIdentityKeyRef = useRef<string | null>(null);
  const selfReportIdentityKeyRef = useRef<string | null>(null);
  const inputIdentityKeyRef = useRef<string | null>(null);
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

  if (inputIdentityKeyRef.current !== identityKey) {
    inputIdentityKeyRef.current = identityKey;
    handoffPreparedKeyRef.current = null;
    selfReportHydratedKeyRef.current = null;
    askIdRef.current = null;
    variantVersionIdRef.current = null;
    askedPackageRef.current = null;
  }

  useEffect(() => {
    setView(null);
    setPublishHandoffError(null);
    setSelfReport(null);
    viewIdentityKeyRef.current = null;
    errorIdentityKeyRef.current = null;
    selfReportIdentityKeyRef.current = null;
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
        setSelfReport(null);
        setView(null);
        setPublishHandoffError(null);
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
        viewIdentityKeyRef.current = identityKey;
        setView(panel);
      } catch {
        if (cancelled) return;
        errorIdentityKeyRef.current = identityKey;
        setPublishHandoffError(
          '手机交接暂未准备好，请刷新后重试，或前往结果中心完成交接。'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, identityKey, packageId, platform, variantVersionId, workId]);

  useEffect(() => {
    if (!enabled || !identityKey || !packageId || !workId) return;
    if (viewIdentityKeyRef.current !== identityKey) return;
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
        selfReportIdentityKeyRef.current = identityKey;
        setSelfReport(decision);
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

  const visibleView =
    identityKey && viewIdentityKeyRef.current === identityKey ? view : null;
  const visibleError =
    identityKey && errorIdentityKeyRef.current === identityKey
      ? publishHandoffError
      : null;
  const visibleSelfReport =
    identityKey && selfReportIdentityKeyRef.current === identityKey
      ? selfReport
      : null;

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
      if (!visibleView) {
        throw new Error('Publish handoff materials are not ready.');
      }
      // Same channel as result-center full_package (result_export → asset URL).
      await exportAndDownloadFullPackage({
        packageId: visibleView.contentPackageId,
        expectedRevision: visibleView.publicationBindingRevision,
        platform: visibleView.platform || platform,
        fileName,
        transport: commandP1,
      });
    },
    [platform, visibleView]
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
          selfReportIdentityKeyRef.current = identityKey;
          setSelfReport(decision);
        } catch {
          /* observation only */
        }
      }
    },
    [identityKey, platform, variantVersionId, workId]
  );

  const onSelfReportChip = useCallback(
    async (signal: OutcomeSelfReportChipSignal) => {
      const askedPackage = identityKey ? askedPackageRef.current : null;
      if (!askedPackage || !workId) return;
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
      setSelfReport({ kind: 'skip', reason: 'already_answered' });
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
    setSelfReport({ kind: 'skip', reason: 'already_asked_this_work' });
  }, [identityKey, workId]);

  const selfReportPrompt =
    visibleSelfReport?.kind === 'ask' ? visibleSelfReport.prompt : null;
  const selfReportChips =
    visibleSelfReport?.kind === 'ask' ? visibleSelfReport.chips : undefined;

  return useMemo(
    () => ({
      publishHandoffError: visibleError,
      publishHandoffView: visibleView,
      selfReportPrompt,
      selfReportChips,
      onPublishHandoffCopy,
      onPublishHandoffDownloadZip,
      onPublishHandoffRecordPublished,
      onSelfReportChip,
      onSelfReportIgnore,
    }),
    [
      visibleView,
      visibleError,
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
