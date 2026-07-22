/**
 * Delivery action receipt pure projection (P1-D1 / #156).
 *
 * Receipt kinds are ledger facts — never ContentPackage aggregate states.
 * shared / handed_off never imply published. Share cancel writes nothing.
 */

export const DELIVERY_ACTION_RECEIPT_KINDS = [
  'prepared',
  'downloaded',
  'copied',
  'shared',
  'handed_off',
  'failed',
] as const;

export type DeliveryActionReceiptKind =
  (typeof DELIVERY_ACTION_RECEIPT_KINDS)[number];

/** Exact merchant labels — do not collapse into a vague "完成". */
export const DELIVERY_ACTION_RECEIPT_LABEL: Record<
  DeliveryActionReceiptKind,
  string
> = {
  prepared: '资料已准备',
  downloaded: '已下载',
  copied: '已复制',
  shared: '已交给系统分享',
  handed_off: '已交接',
  failed: '交付失败',
};

/**
 * Binding required on every delivery receipt.
 * Exact ContentPackage revision + platform + account/owner + purpose + actor + time.
 */
export type DeliveryActionReceiptBinding = {
  contentPackageId: string;
  contentPackageRevision: number;
  platform: string;
  /** Account display label OR external owner label. */
  accountOrOwnerLabel: string;
  purpose: string;
  actorId: string;
  occurredAt: string;
  /** Optional variant for platform-specific package truth. */
  variantVersionId?: string;
};

export type DeliveryActionReceiptFact = {
  id: string;
  kind: DeliveryActionReceiptKind;
  binding: DeliveryActionReceiptBinding;
  /**
   * Stable idempotency key — same command replays the same receipt.
   * Format suggestion: `${packageId}:${revision}:${kind}:${platform}:${purpose}`
   */
  idempotencyKey: string;
  /** Failure reason when kind === failed. */
  failureReason?: string;
};

export type DeliveryShareAttemptInput =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

export type DeliveryShareAttemptProjection = {
  /** Only true when the system share sheet completed. */
  writesReceipt: boolean;
  receiptKind: 'shared' | null;
  /** Always false — system share is never platform publish. */
  platformPublished: false;
  message: string;
};

export type DeliveryDegradeStep = {
  strategy: 'file' | 'one_shot_link' | 'download';
  label: string;
  explanation: string;
};

export type DeliveryActionReceiptPanelView =
  | {
      kind: 'ready';
      heading: string;
      summary: string;
      receipts: Array<{
        id: string;
        kind: DeliveryActionReceiptKind;
        label: string;
        platform: string;
        accountOrOwnerLabel: string;
        purpose: string;
        occurredAtLabel: string;
        revisionLabel: string;
        /** Hard product rule: never true for non-publish receipts. */
        claimsPublished: false;
      }>;
      latestKind: DeliveryActionReceiptKind | null;
      /** True when any handed_off/shared exists without a later publication. */
      handedOffIsNotPublished: boolean;
      degradeSteps: DeliveryDegradeStep[];
    }
  | {
      kind: 'fail_closed';
      heading: string;
      reason:
        | 'missing_package_revision'
        | 'missing_binding'
        | 'no_receipts_yet';
      message: string;
    };

export function deliveryActionReceiptIdempotencyKey(input: {
  contentPackageId: string;
  contentPackageRevision: number;
  kind: DeliveryActionReceiptKind;
  platform: string;
  purpose: string;
}): string {
  return [
    input.contentPackageId,
    String(input.contentPackageRevision),
    input.kind,
    input.platform,
    input.purpose,
  ].join(':');
}

/**
 * Share attempt → receipt bookkeeping.
 * Cancel / abort never write a success receipt (P1-D1).
 */
export function projectShareAttemptReceipt(
  attempt: DeliveryShareAttemptInput
): DeliveryShareAttemptProjection {
  switch (attempt.kind) {
    case 'shared':
      return {
        writesReceipt: true,
        receiptKind: 'shared',
        platformPublished: false,
        message: DELIVERY_ACTION_RECEIPT_LABEL.shared,
      };
    case 'cancelled':
      return {
        writesReceipt: false,
        receiptKind: null,
        platformPublished: false,
        message: '已取消系统分享，未记为已交付',
      };
    case 'failed':
      return {
        writesReceipt: false,
        receiptKind: null,
        platformPublished: false,
        message: attempt.reason || '系统分享失败，可改用一次性链接或下载',
      };
  }
}

/**
 * Multi-file share unavailable → one-shot link → ZIP/single download.
 * Each step keeps an honest user-language explanation.
 */
export function projectShareDegradeExplanations(input: {
  canShareFiles: boolean;
  hasOneShotLink: boolean;
  hasDownload: boolean;
}): DeliveryDegradeStep[] {
  const steps: DeliveryDegradeStep[] = [];
  if (input.canShareFiles) {
    steps.push({
      strategy: 'file',
      label: '系统分享文件',
      explanation: '优先用系统分享直接交出成品文件',
    });
  }
  if (input.hasOneShotLink) {
    steps.push({
      strategy: 'one_shot_link',
      label: '一次性交接链接',
      explanation: input.canShareFiles
        ? '多文件分享不可用时，改用短期一次性链接'
        : '当前设备不能分享文件，改用短期一次性链接',
    });
  }
  if (input.hasDownload) {
    steps.push({
      strategy: 'download',
      label: '下载发布包',
      explanation:
        input.canShareFiles || input.hasOneShotLink
          ? '链接也不可用时，下载 ZIP 或单项文件继续交付'
          : '下载 ZIP 或单项文件后自行发布',
    });
  }
  return steps;
}

function formatOccurredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return iso.slice(0, 16);
  }
}

function isCompleteBinding(
  binding: DeliveryActionReceiptBinding | undefined
): binding is DeliveryActionReceiptBinding {
  if (!binding) return false;
  if (!binding.contentPackageId.trim()) return false;
  if (!Number.isInteger(binding.contentPackageRevision)) return false;
  if (binding.contentPackageRevision < 0) return false;
  if (!binding.platform.trim()) return false;
  if (!binding.accountOrOwnerLabel.trim()) return false;
  if (!binding.purpose.trim()) return false;
  if (!binding.actorId.trim()) return false;
  if (!binding.occurredAt.trim()) return false;
  return true;
}

/**
 * Project delivery action receipts for Result / Delivery surfaces.
 * Fail closed when package revision binding is absent.
 */
export function projectDeliveryActionReceiptPanel(input: {
  contentPackageId?: string;
  contentPackageRevision?: number;
  receipts?: readonly DeliveryActionReceiptFact[];
  canShareFiles?: boolean;
  hasOneShotLink?: boolean;
  hasDownload?: boolean;
  /** When true, a verified or manual publication record already exists. */
  hasPublicationRecord?: boolean;
}): DeliveryActionReceiptPanelView {
  const heading = '交付回执';
  if (
    input.contentPackageId === undefined ||
    input.contentPackageRevision === undefined ||
    !Number.isInteger(input.contentPackageRevision) ||
    input.contentPackageRevision < 0
  ) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'missing_package_revision',
      message: '尚未绑定精确成品版本，无法记录交付回执。',
    };
  }

  const receipts = (input.receipts ?? []).filter((receipt) =>
    isCompleteBinding(receipt.binding)
  );

  if ((input.receipts?.length ?? 0) > 0 && receipts.length === 0) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'missing_binding',
      message: '交付回执缺少平台、责任人或用途绑定，已隐藏不完整记录。',
    };
  }

  if (receipts.length === 0) {
    return {
      kind: 'fail_closed',
      heading,
      reason: 'no_receipts_yet',
      message: '还没有交付回执。复制、下载、分享或交接后会出现在这里。',
    };
  }

  const ordered = [...receipts].sort((a, b) =>
    a.binding.occurredAt.localeCompare(b.binding.occurredAt)
  );
  const latest = ordered.at(-1) ?? null;
  const hasHandedOrShared = ordered.some(
    (r) => r.kind === 'handed_off' || r.kind === 'shared'
  );

  return {
    kind: 'ready',
    heading,
    summary: '交付回执只记录准备、下载、复制、分享与交接；不等于已发布。',
    receipts: ordered.map((receipt) => ({
      id: receipt.id,
      kind: receipt.kind,
      label: DELIVERY_ACTION_RECEIPT_LABEL[receipt.kind],
      platform: receipt.binding.platform,
      accountOrOwnerLabel: receipt.binding.accountOrOwnerLabel,
      purpose: receipt.binding.purpose,
      occurredAtLabel: formatOccurredAt(receipt.binding.occurredAt),
      revisionLabel: `版本 r${receipt.binding.contentPackageRevision}`,
      claimsPublished: false as const,
    })),
    latestKind: latest?.kind ?? null,
    handedOffIsNotPublished:
      hasHandedOrShared && input.hasPublicationRecord !== true,
    degradeSteps: projectShareDegradeExplanations({
      canShareFiles: input.canShareFiles ?? false,
      hasOneShotLink: input.hasOneShotLink ?? false,
      hasDownload: input.hasDownload ?? true,
    }),
  };
}

/**
 * Deduplicate receipts by idempotency key — later duplicates are ignored.
 */
export function dedupeDeliveryActionReceipts(
  receipts: readonly DeliveryActionReceiptFact[]
): DeliveryActionReceiptFact[] {
  const seen = new Set<string>();
  const out: DeliveryActionReceiptFact[] = [];
  for (const receipt of receipts) {
    if (seen.has(receipt.idempotencyKey)) continue;
    seen.add(receipt.idempotencyKey);
    out.push(receipt);
  }
  return out;
}

/**
 * Map low-level UI events onto receipt kinds.
 * Share cancel returns null (no ledger write).
 */
export function receiptKindFromDeliveryEvent(
  event:
    | 'materials_prepared'
    | 'downloaded'
    | 'copied'
    | 'shared'
    | 'share_cancelled'
    | 'handed_over'
    | 'failed'
): DeliveryActionReceiptKind | null {
  switch (event) {
    case 'materials_prepared':
      return 'prepared';
    case 'downloaded':
      return 'downloaded';
    case 'copied':
      return 'copied';
    case 'shared':
      return 'shared';
    case 'share_cancelled':
      return null;
    case 'handed_over':
      return 'handed_off';
    case 'failed':
      return 'failed';
  }
}
