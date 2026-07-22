/**
 * Post-auth restore confirmation for Landing intent handoff (#148).
 * Never auto-submits or charges — user must confirm, edit, or discard.
 */

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  landing_handoff_restore_confirm,
  landing_handoff_restore_discard,
  landing_handoff_restore_edit_label,
  landing_handoff_restore_hint,
  landing_handoff_restore_title,
} from '@/locale/paraglide/messages';
import type { CreationLensId } from '@meiye/contracts';
import { useEffect, useState } from 'react';

import {
  clearLandingHandoff,
  readLandingHandoff,
  type LandingHandoff,
} from './landing-handoff';

export type LandingHandoffRestoreProps = {
  onConfirm: (input: { intent: string; lens?: CreationLensId }) => void;
  onDiscard?: () => void;
};

export function LandingHandoffRestore({
  onConfirm,
  onDiscard,
}: LandingHandoffRestoreProps) {
  const [handoff, setHandoff] = useState<LandingHandoff | null>(null);
  const [intent, setIntent] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const pending = readLandingHandoff();
    if (!pending) return;
    setHandoff(pending);
    setIntent(pending.intent);
    setVisible(true);
  }, []);

  if (!visible || !handoff) return null;

  const dismiss = (confirmed: boolean) => {
    clearLandingHandoff();
    setVisible(false);
    if (!confirmed) {
      onDiscard?.();
    }
  };

  return (
    <section
      aria-labelledby="landing-handoff-restore-title"
      className="rounded-2xl border border-border bg-muted/40 p-4"
      data-testid="landing-handoff-restore"
    >
      <h2 className="text-base font-medium" id="landing-handoff-restore-title">
        {landing_handoff_restore_title()}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {landing_handoff_restore_hint()}
      </p>
      <label
        className="mt-3 block text-sm font-medium"
        htmlFor="landing-handoff-intent"
      >
        {landing_handoff_restore_edit_label()}
      </label>
      <Textarea
        className="mt-1 min-h-24 resize-none"
        data-testid="landing-handoff-intent-edit"
        id="landing-handoff-intent"
        onChange={(event) => setIntent(event.target.value)}
        value={intent}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          data-testid="landing-handoff-confirm"
          disabled={intent.trim().length < 2}
          onClick={() => {
            const next = intent.trim();
            if (next.length < 2) return;
            dismiss(true);
            onConfirm({
              intent: next,
              ...(handoff.lens ? { lens: handoff.lens } : {}),
            });
          }}
          type="button"
        >
          {landing_handoff_restore_confirm()}
        </Button>
        <Button
          data-testid="landing-handoff-discard"
          onClick={() => dismiss(false)}
          type="button"
          variant="outline"
        >
          {landing_handoff_restore_discard()}
        </Button>
      </div>
    </section>
  );
}
