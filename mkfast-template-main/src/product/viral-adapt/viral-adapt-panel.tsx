/**
 * Viral adapt host panel — mounts sourcing + confirm cards (#324).
 */

import { ViralAdaptConfirmCard } from './viral-adapt-confirm-card';
import { ViralAdaptSourcingCard } from './viral-adapt-sourcing-card';
import type {
  ViralAdaptJourneyState,
  ViralPasteDraft,
} from './viral-adapt-journey';

export type ViralAdaptPanelProps = {
  state: ViralAdaptJourneyState;
  onDraftChange: (patch: Partial<ViralPasteDraft>) => void;
  onSourcingContinue: () => void;
  onSourcingCancel: () => void;
  onConfirm: () => void;
  onConfirmBack: () => void;
  onAddImageLabel?: (label: string) => void;
  busy?: boolean;
};

export function ViralAdaptPanel({
  state,
  onDraftChange,
  onSourcingContinue,
  onSourcingCancel,
  onConfirm,
  onConfirmBack,
  onAddImageLabel,
  busy = false,
}: ViralAdaptPanelProps) {
  if (state.phase === 'sourcing') {
    return (
      <ViralAdaptSourcingCard
        busy={busy}
        onAddImageLabel={onAddImageLabel}
        onCancel={onSourcingCancel}
        onContinue={onSourcingContinue}
        onDraftChange={onDraftChange}
        state={state}
      />
    );
  }
  if (state.phase === 'confirm' && state.confirm) {
    return (
      <ViralAdaptConfirmCard
        busy={busy}
        confirm={state.confirm}
        onBack={onConfirmBack}
        onConfirm={onConfirm}
      />
    );
  }
  return null;
}
