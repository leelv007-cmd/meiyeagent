import type {
  CreativeBrief,
  CreativeBriefFieldId,
  CreativeBriefUpdate,
  CreativeSourceReference,
  ProductState,
} from '@meiye/contracts';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  creation_assistant_field_audience,
  creation_assistant_field_intent,
  creation_assistant_field_scene,
  creation_assistant_field_tone,
  creative_brief_adopt_ai,
  creative_brief_ai_draft,
  creative_brief_aria,
  creative_brief_auto_confirming,
  creative_brief_collapse,
  creative_brief_confirm,
  creative_brief_confirm_hint,
  creative_brief_confirmed,
  creative_brief_confirmed_hint,
  creative_brief_current,
  creative_brief_description,
  creative_brief_edit,
  creative_brief_edit_aria,
  creative_brief_expand,
  creative_brief_owner_ai,
  creative_brief_owner_merchant,
  creative_brief_owner_pending,
  creative_brief_revert_ai,
  creative_brief_save_edit,
  creative_brief_unconfirmed,
  creative_brief_using,
} from '@/locale/paraglide/messages';
import { isContentPackageEligibleAsset } from './canonical-asset-governance-model';

const BRIEF_FIELDS = [
  ['intent', creation_assistant_field_intent],
  ['scene', creation_assistant_field_scene],
  ['tone', creation_assistant_field_tone],
  ['audience', creation_assistant_field_audience],
] as const;

export type CreativeBriefDrafts = Record<CreativeBriefFieldId, string>;

export type CreativeGroundingRequirement =
  | 'confirmed_store'
  | 'confirmed_project'
  | 'confirmed_qualification'
  | 'real_authorized_asset';

export function missingCreativeGrounding(
  product: ProductState | undefined,
  sourceReferences: CreativeSourceReference[]
): CreativeGroundingRequirement[] {
  const missing: CreativeGroundingRequirement[] = [];
  if (!product?.store?.confirmedAt) missing.push('confirmed_store');
  if (!product?.store?.projects.some((project) => project.confirmed)) {
    missing.push('confirmed_project');
  }
  if (product?.store?.regulated && !product.qualification?.confirmed) {
    missing.push('confirmed_qualification');
  }
  const assetIds = sourceReferences
    .filter((reference) => reference.kind === 'asset')
    .map((reference) => reference.id);
  const allAssetsReady =
    assetIds.length > 0 &&
    assetIds.every((assetId) => {
      const asset = product?.assets.find(
        (candidate) => candidate.id === assetId
      );
      return Boolean(asset && isContentPackageEligibleAsset(asset));
    });
  if (assetIds.length > 0 && !allAssetsReady) {
    missing.push('real_authorized_asset');
  }
  return missing;
}

/** Confirmed field values only — never fall back to unconfirmed drafts. */
export function confirmedBriefChips(
  brief: CreativeBrief | undefined
): Array<{ field: CreativeBriefFieldId; label: string; value: string }> {
  if (!brief?.confirmedAt) return [];
  return BRIEF_FIELDS.flatMap(([field, label]) => {
    const value = brief.fields[field]?.current?.trim();
    if (!value) return [];
    return [{ field, label: label(), value }];
  });
}

export function missingBriefAdoptFields(
  brief: CreativeBrief | undefined,
  drafts: CreativeBriefDrafts
): Array<{ field: CreativeBriefFieldId; aiDraft: string }> {
  return BRIEF_FIELDS.flatMap(([field]) => {
    if (brief?.fields[field]) return [];
    const aiDraft = drafts[field]?.trim();
    if (!aiDraft) return [];
    return [{ field, aiDraft }];
  });
}

export function CreativeBriefEditor({
  autoConfirming = false,
  brief,
  busy,
  drafts,
  onConfirm,
  onUpdate,
}: {
  autoConfirming?: boolean;
  brief?: CreativeBrief;
  busy: boolean;
  drafts: CreativeBriefDrafts;
  onConfirm: () => Promise<void>;
  onUpdate: (update: CreativeBriefUpdate) => Promise<void>;
}) {
  const [editingField, setEditingField] = useState<CreativeBriefFieldId>();
  const [editingValue, setEditingValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const chips = confirmedBriefChips(brief);
  const confirmed = Boolean(brief?.confirmedAt);

  const confirmBrief = async () => {
    for (const [field] of BRIEF_FIELDS) {
      if (!brief?.fields[field]) {
        await onUpdate({ action: 'adopt', aiDraft: drafts[field], field });
      }
    }
    await onConfirm();
  };

  if (autoConfirming && !confirmed) {
    return (
      <section
        aria-busy="true"
        aria-label={creative_brief_aria()}
        className="space-y-2"
        data-testid="creative-brief-auto-confirming"
      >
        <p className="text-sm text-muted-foreground">
          {creative_brief_auto_confirming()}
        </p>
      </section>
    );
  }

  if (confirmed && !expanded) {
    return (
      <section
        aria-label={creative_brief_aria()}
        className="space-y-3"
        data-testid="creative-brief-chips"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{creative_brief_using()}</p>
          <Badge variant="secondary">{creative_brief_confirmed()}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              className="max-w-full rounded-full border border-divider bg-surface-1 px-3 py-1.5 text-left text-xs transition hover:bg-surface-2"
              data-brief-chip={chip.field}
              key={chip.field}
              onClick={() => setExpanded(true)}
              type="button"
            >
              <span className="font-medium text-muted-foreground">
                {chip.label}
              </span>
              <span className="ml-1.5 text-foreground">
                {chip.value.length > 28
                  ? `${chip.value.slice(0, 28)}…`
                  : chip.value}
              </span>
            </button>
          ))}
        </div>
        <Button
          onClick={() => setExpanded(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {creative_brief_expand()}
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-label={creative_brief_aria()}
      className="space-y-4"
      data-testid="creative-brief-editor"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={confirmed ? 'secondary' : 'outline'}>
            {confirmed
              ? creative_brief_confirmed()
              : creative_brief_unconfirmed()}
          </Badge>
          {confirmed ? (
            <Button
              onClick={() => {
                setExpanded(false);
                setEditingField(undefined);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {creative_brief_collapse()}
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {creative_brief_description()}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {BRIEF_FIELDS.map(([field, label]) => {
          const saved = brief?.fields[field];
          // Expanded editor may show drafts for edit takeover, but never as
          // confirmed current values in the chips summary path above.
          const current = saved?.current ?? drafts[field];
          const isEditing = editingField === field;
          return (
            <section
              className="space-y-3 rounded-md border border-divider bg-surface-0 p-3"
              data-brief-field={field}
              key={field}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{label()}</p>
                <Badge variant="outline">
                  {saved?.owner === 'merchant'
                    ? creative_brief_owner_merchant()
                    : saved?.owner === 'ai'
                      ? creative_brief_owner_ai()
                      : creative_brief_owner_pending()}
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{creative_brief_ai_draft()}</p>
                <p className="whitespace-pre-wrap text-foreground">
                  {saved?.aiDraft ?? drafts[field]}
                </p>
              </div>
              {isEditing ? (
                <Textarea
                  aria-label={creative_brief_edit_aria({ field: label() })}
                  disabled={busy}
                  onChange={(event) =>
                    setEditingValue(event.currentTarget.value)
                  }
                  value={editingValue}
                />
              ) : (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>{creative_brief_current()}</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {current}
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!saved ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void onUpdate({
                        action: 'adopt',
                        aiDraft: drafts[field],
                        field,
                      })
                    }
                    size="sm"
                    type="button"
                  >
                    {creative_brief_adopt_ai()}
                  </Button>
                ) : null}
                {isEditing ? (
                  <Button
                    disabled={busy || !editingValue.trim()}
                    onClick={() => {
                      void onUpdate({
                        action: 'edit',
                        current: editingValue,
                        field,
                      }).then(() => setEditingField(undefined));
                    }}
                    size="sm"
                    type="button"
                  >
                    {creative_brief_save_edit()}
                  </Button>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditingField(field);
                      setEditingValue(current);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {creative_brief_edit()}
                  </Button>
                )}
                {saved?.aiDraft && saved.owner === 'merchant' ? (
                  <Button
                    disabled={busy}
                    onClick={() => void onUpdate({ action: 'revert', field })}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {creative_brief_revert_ai()}
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {confirmed ? (
        <p aria-live="polite" className="text-sm font-medium text-primary">
          {creative_brief_confirmed_hint()}
        </p>
      ) : (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="mb-3 text-sm text-muted-foreground">
            {creative_brief_confirm_hint()}
          </p>
          <Button
            disabled={busy}
            onClick={() => void confirmBrief()}
            type="button"
          >
            {creative_brief_confirm()}
          </Button>
        </div>
      )}
    </section>
  );
}
