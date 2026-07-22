/**
 * Progressive rights single-question card for restricted customer assets (#149).
 * Subject → purpose → platforms → term; advanced evidence on demand with draft retention.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  progressive_rights_advanced_collapse,
  progressive_rights_advanced_expand,
  progressive_rights_confirm,
  progressive_rights_continue,
  progressive_rights_evidence_label,
  progressive_rights_exceptions_label,
  progressive_rights_impact_label,
  progressive_rights_internal_saved,
  progressive_rights_platform_douyin,
  progressive_rights_platform_xiaohongshu,
  progressive_rights_platforms_label,
  progressive_rights_purpose_internal,
  progressive_rights_purpose_label,
  progressive_rights_purpose_public,
  progressive_rights_subject_label,
  progressive_rights_subject_placeholder,
  progressive_rights_term_date,
  progressive_rights_term_label,
  progressive_rights_term_no_expiry,
  progressive_rights_title,
  progressive_rights_why_label,
} from '@/locale/paraglide/messages';
import type { Platform } from '@meiye/contracts';
import { useMemo, useState } from 'react';

import {
  answerRightsPurpose,
  answerRightsSubject,
  answerRightsTerm,
  createProgressiveRightsDraft,
  progressiveRightsToFacts,
  projectProgressiveRightsView,
  rightsQuestionMeta,
  setRightsAdvancedOpen,
  toggleRightsPlatform,
  updateRightsAdvancedDraft,
  type ProgressiveRightsDraft,
  type RightsPurpose,
} from './progressive-rights';

export type ProgressiveRightsFacts = NonNullable<
  ReturnType<typeof progressiveRightsToFacts>
>;

export type ProgressiveRightsCardProps = {
  category?: ProgressiveRightsFacts['category'];
  containsPerson?: boolean;
  containsSensitiveData?: boolean;
  minorStatus?: 'none' | 'minor';
  /** Seed known answers (e.g. purpose already chosen in parent). */
  initialDraft?: Partial<ProgressiveRightsDraft>;
  onConfirm: (facts: ProgressiveRightsFacts) => void;
  pending?: boolean;
};
const PLATFORM_OPTIONS: Array<[Platform, () => string]> = [
  ['xiaohongshu', progressive_rights_platform_xiaohongshu],
  ['douyin', progressive_rights_platform_douyin],
];

export function ProgressiveRightsCard({
  category = 'customer_case',
  containsPerson = true,
  containsSensitiveData = false,
  minorStatus = 'none',
  initialDraft,
  onConfirm,
  pending = false,
}: ProgressiveRightsCardProps) {
  const [draft, setDraft] = useState<ProgressiveRightsDraft>(() =>
    createProgressiveRightsDraft(initialDraft)
  );
  const [subjectDraft, setSubjectDraft] = useState(
    () => initialDraft?.subject ?? ''
  );
  const view = useMemo(() => projectProgressiveRightsView(draft), [draft]);
  const current = view.currentQuestionId
    ? rightsQuestionMeta(view.currentQuestionId)
    : null;

  const commitFacts = (next: ProgressiveRightsDraft) => {
    const facts = progressiveRightsToFacts({
      draft: next,
      category,
      containsPerson,
      containsSensitiveData,
      minorStatus,
    });
    if (!facts) return;
    onConfirm(facts);
  };

  return (
    <section
      aria-labelledby="progressive-rights-title"
      className="space-y-3 rounded-2xl bg-muted p-3"
      data-testid="progressive-rights-card"
    >
      <h3 className="text-sm font-medium" id="progressive-rights-title">
        {progressive_rights_title()}
      </h3>

      {current ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">
              {progressive_rights_why_label()}：
            </span>
            {current.why}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">
              {progressive_rights_impact_label()}：
            </span>
            {current.impact}
          </p>
        </div>
      ) : null}

      {view.currentQuestionId === 'subject' ? (
        <div className="space-y-2">
          <label
            className="text-xs font-medium"
            htmlFor="progressive-rights-subject"
          >
            {progressive_rights_subject_label()}
          </label>
          <Input
            data-testid="progressive-rights-subject"
            disabled={pending}
            id="progressive-rights-subject"
            onChange={(event) => setSubjectDraft(event.target.value)}
            placeholder={progressive_rights_subject_placeholder()}
            value={subjectDraft}
          />
          <Button
            data-testid="progressive-rights-subject-continue"
            disabled={pending || subjectDraft.trim().length < 2}
            onClick={() => setDraft(answerRightsSubject(draft, subjectDraft))}
            size="sm"
            type="button"
          >
            {progressive_rights_continue()}
          </Button>
        </div>
      ) : null}

      {view.currentQuestionId === 'purpose' ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">
            {progressive_rights_purpose_label()}
          </legend>
          <div className="grid gap-2">
            {(
              [
                ['public_marketing', progressive_rights_purpose_public],
                ['internal_only', progressive_rights_purpose_internal],
              ] as const
            ).map(([purpose, label]) => (
              <Button
                data-testid={`progressive-rights-purpose-${purpose}`}
                disabled={
                  pending ||
                  (purpose === 'public_marketing' && minorStatus === 'minor')
                }
                key={purpose}
                onClick={() => {
                  const next = answerRightsPurpose(
                    draft,
                    purpose as RightsPurpose
                  );
                  setDraft(next);
                  if (purpose === 'internal_only') {
                    commitFacts(next);
                  }
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {label()}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {view.currentQuestionId === 'platforms' ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">
            {progressive_rights_platforms_label()}
          </legend>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map(([platform, label]) => {
              const selected = draft.platforms.includes(platform);
              return (
                <Button
                  aria-pressed={selected}
                  data-testid={`progressive-rights-platform-${platform}`}
                  disabled={pending}
                  key={platform}
                  onClick={() =>
                    setDraft(toggleRightsPlatform(draft, platform))
                  }
                  size="sm"
                  type="button"
                  variant={selected ? 'secondary' : 'outline'}
                >
                  {label()}
                </Button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {view.currentQuestionId === 'term' ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">
            {progressive_rights_term_label()}
          </legend>
          <Button
            aria-pressed={draft.noFixedExpiry}
            data-testid="progressive-rights-no-expiry"
            disabled={pending}
            onClick={() =>
              setDraft(answerRightsTerm(draft, { noFixedExpiry: true }))
            }
            size="sm"
            type="button"
            variant={draft.noFixedExpiry ? 'secondary' : 'outline'}
          >
            {progressive_rights_term_no_expiry()}
          </Button>
          {!draft.noFixedExpiry ? (
            <Input
              aria-label={progressive_rights_term_date()}
              data-testid="progressive-rights-valid-until"
              disabled={pending}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) =>
                setDraft(
                  answerRightsTerm(draft, {
                    noFixedExpiry: false,
                    validUntil: event.target.value,
                  })
                )
              }
              type="date"
              value={draft.validUntil}
            />
          ) : null}
        </fieldset>
      ) : null}

      {view.readyForAuthorize &&
      view.effectiveConsentScope === 'public_marketing' ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          {draft.advancedOpen ? (
            <>
              <Button
                className="h-auto px-0 py-1 text-xs font-normal text-muted-foreground"
                data-testid="progressive-rights-advanced-collapse"
                onClick={() => setDraft(setRightsAdvancedOpen(draft, false))}
                type="button"
                variant="ghost"
              >
                {progressive_rights_advanced_collapse()}
              </Button>
              <label
                className="block text-xs font-medium"
                htmlFor="progressive-rights-evidence"
              >
                {progressive_rights_evidence_label()}
                <Input
                  className="mt-1 bg-surface-1"
                  data-testid="progressive-rights-evidence"
                  id="progressive-rights-evidence"
                  onChange={(event) =>
                    setDraft(
                      updateRightsAdvancedDraft(draft, {
                        evidence: event.target.value,
                      })
                    )
                  }
                  value={draft.evidence}
                />
              </label>
              <label
                className="block text-xs font-medium"
                htmlFor="progressive-rights-exceptions"
              >
                {progressive_rights_exceptions_label()}
                <Input
                  className="mt-1 bg-surface-1"
                  data-testid="progressive-rights-exceptions"
                  id="progressive-rights-exceptions"
                  onChange={(event) =>
                    setDraft(
                      updateRightsAdvancedDraft(draft, {
                        exceptions: event.target.value,
                      })
                    )
                  }
                  value={draft.exceptions}
                />
              </label>
            </>
          ) : (
            <Button
              className="h-auto px-0 py-1 text-xs font-normal text-muted-foreground"
              data-testid="progressive-rights-advanced-expand"
              onClick={() => setDraft(setRightsAdvancedOpen(draft, true))}
              type="button"
              variant="ghost"
            >
              {progressive_rights_advanced_expand()}
            </Button>
          )}
          <Button
            data-testid="progressive-rights-confirm"
            disabled={pending}
            onClick={() => commitFacts(draft)}
            size="sm"
            type="button"
          >
            {progressive_rights_confirm()}
          </Button>
        </div>
      ) : null}

      {view.effectiveConsentScope === 'internal_only' ? (
        <p className="text-xs text-muted-foreground">
          {progressive_rights_internal_saved()}
        </p>
      ) : null}
    </section>
  );
}
