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
  onRequestImageUpload?: () => void;
  busy?: boolean;
};

export function ViralAdaptPanel({
  state,
  onDraftChange,
  onSourcingContinue,
  onSourcingCancel,
  onConfirm,
  onConfirmBack,
  onRequestImageUpload,
  busy = false,
}: ViralAdaptPanelProps) {
  if (state.phase === 'sourcing') {
    return (
      <ViralAdaptSourcingCard
        busy={busy}
        onCancel={onSourcingCancel}
        onContinue={onSourcingContinue}
        onDraftChange={onDraftChange}
        onRequestImageUpload={onRequestImageUpload}
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
