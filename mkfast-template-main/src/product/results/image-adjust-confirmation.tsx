import { Button } from '@/components/ui/button';
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
    <section
      aria-label="确认本次调整"
      className="mx-auto mb-4 max-w-3xl space-y-3 rounded-xl border bg-card p-4 shadow-sm"
      data-testid="image-adjust-confirmation"
      role="dialog"
    >
      <div>
        <h2 className="font-semibold">确认本次调整</h2>
        <p className="text-sm text-muted-foreground">
          {scopeLabel}·{amount}
        </p>
      </div>
      <p className="text-sm">{props.instruction}</p>
      {props.error ? (
        <p className="text-sm text-destructive" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
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
      </div>
    </section>
  );
}
