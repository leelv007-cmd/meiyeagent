/**
 * Viral adapt 确认卡 — explicit sourcing method + specs (#324 / §4.3).
 *
 * Read-only projection: confirm or back. No settings pickers (D-159③ spirit).
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { ViralAdaptConfirmView } from './viral-adapt-journey';

export type ViralAdaptConfirmCardProps = {
  confirm: ViralAdaptConfirmView;
  onConfirm: () => void;
  onBack: () => void;
  busy?: boolean;
  className?: string;
};

export function ViralAdaptConfirmCard({
  confirm,
  onConfirm,
  onBack,
  busy = false,
  className,
}: ViralAdaptConfirmCardProps) {
  return (
    <section
      aria-label="爆款复刻确认"
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 bg-background',
        className
      )}
      data-testid="viral-adapt-confirm-card"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">
          确认复刻规格与取材
        </h2>
        <p className="meiye-type-aux">
          生成前请核对取材方式与产出规格。确认后将按 note 全链仿写。
        </p>
      </header>

      <div
        className="rounded-xl border bg-muted/20 p-3"
        data-testid="viral-adapt-confirm-source"
      >
        <p className="meiye-type-aux">取材方式</p>
        <p
          className="text-sm font-medium text-foreground"
          data-testid="viral-adapt-confirm-source-label"
        >
          {confirm.sourceMethod.label}
        </p>
        <p
          className="meiye-type-aux mt-1"
          data-testid="viral-adapt-confirm-source-detail"
        >
          {confirm.sourceMethod.detail}
        </p>
      </div>

      <dl
        className="flex flex-col gap-2"
        data-testid="viral-adapt-confirm-specs"
      >
        {confirm.specs.map((row) => (
          <div className="flex flex-wrap items-baseline gap-2" key={row.key}>
            <dt className="meiye-type-aux">{row.label}</dt>
            <dd
              className="text-sm text-foreground"
              data-testid={`viral-adapt-confirm-spec-${row.key}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div
        className="rounded-xl border border-dashed p-3"
        data-opencli-available={
          confirm.opencliSlot.available ? 'true' : 'false'
        }
        data-testid="viral-adapt-confirm-opencli"
      >
        <p className="text-sm text-foreground">{confirm.opencliSlot.label}</p>
        <p
          className="meiye-type-aux"
          data-testid="viral-adapt-confirm-opencli-status"
        >
          {confirm.opencliSlot.statusLabel}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="viral-adapt-confirm-submit"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          确认并开始仿写
        </Button>
        <Button
          data-testid="viral-adapt-confirm-back"
          disabled={busy}
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          返回修改取材
        </Button>
      </div>
    </section>
  );
}
