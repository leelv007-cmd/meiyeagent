/**
 * Outcome signal chips + evidence ladder (P1-E1 / #158).
 *
 * 375px-friendly chips (min 44×44). Fail closed until published.
 * Never shows causal ROI language for inferred tiers.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  result_outcome_detail_heading,
  result_outcome_detail_note,
  result_outcome_detail_occurred_at,
  result_outcome_detail_quantity,
  result_outcome_detail_yesterday,
} from '@/locale/paraglide/messages';
import { useState } from 'react';

import {
  isUnsafeOutcomeNote,
  type OutcomeObservationKind,
  type OutcomeObservationPanelView,
} from './outcome-observation-model';

/**
 * The three optional fields the contract and core have always carried and the
 * chips never sent. `occurredAt` is the 「这是昨天的」 one: without it every
 * backfilled signal claimed to have happened at the moment it was typed.
 */
export type OutcomeObservationDetail = {
  note?: string;
  occurredAt?: string;
  quantity?: number;
};

export type OutcomeChipsPanelProps = {
  view: OutcomeObservationPanelView;
  pending?: boolean;
  onRecord?: (
    kind: OutcomeObservationKind,
    detail?: OutcomeObservationDetail
  ) => void | Promise<void>;
};

function yesterdayLocalInputValue(now = new Date()): string {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-` +
    `${pad(yesterday.getDate())}T${pad(yesterday.getHours())}:` +
    `${pad(yesterday.getMinutes())}`
  );
}

export function OutcomeChipsPanel(props: OutcomeChipsPanelProps) {
  const { view } = props;
  const [quantity, setQuantity] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');
  const [detailError, setDetailError] = useState<string | null>(null);

  const buildDetail = (): OutcomeObservationDetail | null => {
    const parsedQuantity = quantity.trim()
      ? Number(quantity.trim())
      : undefined;
    if (
      parsedQuantity !== undefined &&
      (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0)
    ) {
      setDetailError('数量填个大于 0 的整数就行。');
      return null;
    }
    const trimmedNote = note.trim() || undefined;
    if (isUnsafeOutcomeNote(trimmedNote)) {
      setDetailError('备注只留一句话，别写进客人的联系方式。');
      return null;
    }
    const occurred = occurredAt ? new Date(occurredAt) : undefined;
    if (occurred && Number.isNaN(occurred.getTime())) {
      setDetailError('时间没认出来，重选一次。');
      return null;
    }
    setDetailError(null);
    return {
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(occurred ? { occurredAt: occurred.toISOString() } : {}),
      ...(parsedQuantity !== undefined ? { quantity: parsedQuantity } : {}),
    };
  };

  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      data-testid="outcome-chips-panel"
      data-panel-kind={view.kind}
      aria-label={view.heading}
    >
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{view.heading}</h3>
        {view.kind === 'ready' ? (
          <p className="text-xs text-muted-foreground">{view.summary}</p>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="outcome-chips-fail-closed"
            data-reason={view.reason}
          >
            {view.message}
          </p>
        )}
      </header>

      <fieldset
        className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
        data-testid="outcome-chips-actions"
      >
        <legend className="sr-only">结果信号补记</legend>
        {view.chips.map((chip) => (
          <Button
            key={chip.kind}
            type="button"
            size="sm"
            variant="outline"
            disabled={!chip.enabled || props.pending}
            data-testid={chip.testId}
            data-enabled={chip.enabled ? 'true' : 'false'}
            className="min-h-11 min-w-11"
            style={{
              minHeight: chip.minHitAreaPx,
              minWidth: chip.minHitAreaPx,
            }}
            onClick={() => {
              if (!chip.enabled || !props.onRecord) return;
              const detail = buildDetail();
              if (!detail) return;
              void props.onRecord(
                chip.kind,
                Object.keys(detail).length > 0 ? detail : undefined
              );
              setQuantity('');
              setOccurredAt('');
              setNote('');
            }}
          >
            {chip.label}
          </Button>
        ))}
      </fieldset>

      {view.kind === 'ready' ? (
        <div className="space-y-2" data-testid="outcome-observation-detail">
          <p className="text-xs text-muted-foreground">
            {result_outcome_detail_heading()}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="outcome-detail-quantity">
                {result_outcome_detail_quantity()}
              </Label>
              <Input
                id="outcome-detail-quantity"
                data-testid="outcome-detail-quantity"
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="outcome-detail-occurred-at">
                {result_outcome_detail_occurred_at()}
              </Label>
              <Input
                id="outcome-detail-occurred-at"
                data-testid="outcome-detail-occurred-at"
                type="datetime-local"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="outcome-detail-note">
                {result_outcome_detail_note()}
              </Label>
              <Input
                id="outcome-detail-note"
                data-testid="outcome-detail-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="outcome-detail-yesterday"
            onClick={() => setOccurredAt(yesterdayLocalInputValue())}
          >
            {result_outcome_detail_yesterday()}
          </Button>
          {detailError ? (
            <p
              className="text-xs text-destructive"
              data-testid="outcome-detail-error"
              role="alert"
            >
              {detailError}
            </p>
          ) : null}
        </div>
      ) : null}

      {view.kind === 'ready' ? (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">结果阶梯</p>
            <div
              className="flex flex-wrap gap-2"
              data-testid="outcome-result-ladder"
            >
              {view.ladder.map((step) => (
                <Badge
                  key={step.id}
                  variant={step.reached ? 'secondary' : 'outline'}
                  data-ladder-step={step.id}
                  data-reached={String(step.reached)}
                  data-state={step.state}
                >
                  {step.label}
                  {!step.reached ? ' · 未知' : ''}
                </Badge>
              ))}
            </div>
          </div>

          {view.groups.map((group) => (
            <div
              key={group.sourceTier}
              className="space-y-2"
              data-testid={`outcome-group-${group.sourceTier}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{group.sourceTierLabel}</p>
                <Badge variant="outline">{group.sourceTier}</Badge>
              </div>
              {group.disclaimer ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="outcome-inferred-disclaimer"
                >
                  {group.disclaimer}
                </p>
              ) : null}
              {group.observations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {group.emptyLabel}
                </p>
              ) : (
                <ul className="space-y-1">
                  {group.observations.map((row) => (
                    <li
                      key={row.id}
                      className="text-sm"
                      data-testid="outcome-observation-row"
                      data-superseded={row.isSuperseded ? 'true' : 'false'}
                    >
                      {row.kindLabel} · {row.occurredAtLabel} · 数量{' '}
                      {row.quantityLabel}
                      {row.supersedesLabel ? ` · ${row.supersedesLabel}` : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
