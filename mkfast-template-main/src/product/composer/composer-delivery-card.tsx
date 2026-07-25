/**
 * 成品交付卡 — the third outbound seam message (T31 / #225).
 *
 * Carries what D-116 calls the 任务总结 (策略依据/版本定位/使用建议), an excerpt of
 * the delivered copy, and the three action entries. ADR-0014 keeps 提交后不跳转:
 * the card is the doorway, so every action *opens the Result Center bound to
 * this revision* rather than mutating anything here — adoption, adjustment and
 * delivery all run through the canonical command path (R-05 唯一写路径), and a
 * second write seam in the conversation is exactly the 第二套提交真相 the ADR
 * forbids.
 *
 * The binding is the point: `revision` comes from the terminal workflow.state
 * snapshot, so 「采用」 acts on the revision the server actually delivered. With
 * no confirmed revision the actions are withheld rather than guessed.
 */

import type { ContentPackageRevisionDelivery } from '@meiye/contracts';

import { cn } from '@/lib/utils';

/** Which Result Center panel an entry opens, bound to the delivered revision. */
export type ComposerDeliveryAction = 'adopt' | 'adjust' | 'export';

export type ComposerDeliveryOpenInput = {
  workId: string;
  taskId: string;
  action: ComposerDeliveryAction | 'open';
  revision: ContentPackageRevisionDelivery | null;
};

const ACTION_LABELS: Record<ComposerDeliveryAction, string> = {
  adopt: '采用这一版',
  adjust: '继续调整',
  export: '导出使用',
};

const ACTION_ORDER: ComposerDeliveryAction[] = ['adopt', 'adjust', 'export'];

export type ComposerDeliveryCardProps = {
  workId: string;
  taskId: string;
  revision: ContentPackageRevisionDelivery | null;
  /** 任务总结 as core wrote it — never re-worded here. */
  statement: string | null;
  /** 候选呈现 — an excerpt of what was delivered, so the card stands alone. */
  excerpt?: { title?: string; body?: string };
  onOpen: (input: ComposerDeliveryOpenInput) => void;
  className?: string;
};

export function ComposerDeliveryCard({
  workId,
  taskId,
  revision,
  statement,
  excerpt,
  onOpen,
  className,
}: ComposerDeliveryCardProps) {
  const body = excerpt?.body?.trim() ?? '';
  const preview = body.length > 120 ? `${body.slice(0, 120)}…` : body;

  return (
    <section
      className={cn('meiye-porcelain rounded-2xl p-4', className)}
      data-package-id={revision?.packageId}
      data-revision={revision?.revision}
      data-testid="composer-delivery-turn"
      data-version-id={revision?.versionId}
    >
      <button
        className="w-full text-left"
        // The container spec opens the Result Center by clicking the card
        // itself; that affordance keeps this id.
        data-testid="composer-delivery-card"
        onClick={() => onOpen({ action: 'open', revision, taskId, workId })}
        type="button"
      >
        <p className="text-foreground text-sm font-medium">
          {revision ? `成品已就绪 · 第 ${revision.revision} 版` : '成品已就绪'}
        </p>
        {statement ? (
          <p
            className="text-muted mt-1 text-xs leading-relaxed"
            data-testid="composer-delivery-statement"
          >
            {statement}
          </p>
        ) : null}
        {preview ? (
          <div className="mt-2" data-testid="composer-delivery-excerpt">
            {excerpt?.title ? (
              <p className="text-foreground text-xs font-medium">
                {excerpt.title}
              </p>
            ) : null}
            <p className="text-muted mt-0.5 text-xs">{preview}</p>
          </div>
        ) : null}
        <p className="text-muted mt-2 text-xs">点开看完整成品</p>
      </button>

      {revision ? (
        <div
          className="mt-3 flex flex-wrap gap-2"
          data-testid="composer-delivery-actions"
        >
          {ACTION_ORDER.map((action) => (
            <button
              className="meiye-glass-piece rounded-full px-3 py-1 text-xs"
              data-testid={`composer-delivery-action-${action}`}
              key={action}
              onClick={() => onOpen({ action, revision, taskId, workId })}
              type="button"
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
