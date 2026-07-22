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
  const amount =
    props.quote.confirmedAmount === undefined
      ? '价格待确认'
      : `${props.quote.confirmedAmount} ${props.quote.formula.currency ?? '额度'}`;

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
