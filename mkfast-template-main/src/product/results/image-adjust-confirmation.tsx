import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  ProductQuoteSnapshot,
  ResultAdjustCommand,
} from '@meiye/contracts';

import {
  quotaSpendLabel,
  type ComposerQuotaResource,
} from '@/product/composer/quota-blocking';

export type ImageAdjustConfirmationProps = {
  busy?: boolean;
  error?: string;
  instruction: string;
  onCancel: () => void;
  onConfirm: () => void;
  quote: ProductQuoteSnapshot;
  scope?: ResultAdjustCommand['scope'];
};

export function ImageAdjustConfirmation(props: ImageAdjustConfirmationProps) {
  const scopeLabel =
    props.scope?.kind === 'set'
      ? `整组 ${props.scope.assetIds.length} 张`
      : props.scope?.kind === 'asset'
        ? '单张图片'
        : '当前结果';
  // D1（2026-07-29 拍板）/ D-109「供应细节不可见」: the merchant sees buckets,
  // never money. This line used to print `${confirmedAmount} ${currency}` and
  // put「4 CNY」in front of a shop owner — the amount belongs in the settings
  // detail view, not on a confirmation.
  // D1（2026-07-29 拍板）/ D-109「供应细节不可见」: the merchant sees buckets,
  // never money. This line used to print `${confirmedAmount} ${currency}` and
  // put「4 CNY」in front of a shop owner — amounts belong in the settings
  // detail view, not on a confirmation.
  const units = props.quote.debitUnits ?? [];
  const amount =
    units.length > 0
      ? `本次用 ${quotaSpendLabel(
          units.map((unit) => ({
            cost: unit.quantity,
            resource: unit.resource as ComposerQuotaResource,
          }))
        )}`
      : '本次会用掉一次生成额度';

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onCancel();
      }}
    >
      <DialogContent
        aria-modal="true"
        className="meiye-product-shell max-w-3xl"
        data-product-modal="image-adjust-confirmation"
        data-testid="image-adjust-confirmation"
        finalFocus={() =>
          document.getElementById('result-adjust-input') ?? false
        }
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>确认本次调整</DialogTitle>
          <DialogDescription>
            {scopeLabel}·{amount}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{props.instruction}</p>
        {props.error ? (
          <p className="text-sm text-destructive" role="alert">
            {props.error}
          </p>
        ) : null}
        <DialogFooter className="mx-0 mb-0 rounded-b-lg">
          <Button
            disabled={props.busy}
            onClick={props.onCancel}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={props.busy} onClick={props.onConfirm} type="button">
            {props.busy ? '正在提交…' : '确认并生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
