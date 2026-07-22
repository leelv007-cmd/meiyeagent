/**
 * Outcome signal chips + evidence ladder (P1-E1 / #158).
 *
 * 375px-friendly chips (min 44×44). Fail closed until published.
 * Never shows causal ROI language for inferred tiers.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import type {
  OutcomeObservationKind,
  OutcomeObservationPanelView,
} from './outcome-observation-model';

export type OutcomeChipsPanelProps = {
  view: OutcomeObservationPanelView;
  pending?: boolean;
  onRecord?: (kind: OutcomeObservationKind) => void | Promise<void>;
};

export function OutcomeChipsPanel(props: OutcomeChipsPanelProps) {
  const { view } = props;

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
              void props.onRecord(chip.kind);
            }}
          >
            {chip.label}
          </Button>
        ))}
      </fieldset>

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
