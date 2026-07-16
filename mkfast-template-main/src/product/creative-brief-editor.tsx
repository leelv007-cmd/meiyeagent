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
import { m } from '@/locale/paraglide/messages';
import { isContentPackageEligibleAsset } from './canonical-asset-governance-model';

const BRIEF_FIELDS = [
  ['intent', m.creation_assistant_field_intent],
  ['scene', m.creation_assistant_field_scene],
  ['tone', m.creation_assistant_field_tone],
  ['audience', m.creation_assistant_field_audience],
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
  if (!allAssetsReady) missing.push('real_authorized_asset');
  return missing;
}

export function CreativeBriefEditor({
  brief,
  busy,
  drafts,
  onConfirm,
  onUpdate,
}: {
  brief?: CreativeBrief;
  busy: boolean;
  drafts: CreativeBriefDrafts;
  onConfirm: () => Promise<void>;
  onUpdate: (update: CreativeBriefUpdate) => Promise<void>;
}) {
  const [editingField, setEditingField] = useState<CreativeBriefFieldId>();
  const [editingValue, setEditingValue] = useState('');

  const confirmBrief = async () => {
    for (const [field] of BRIEF_FIELDS) {
      if (!brief?.fields[field]) {
        await onUpdate({ action: 'adopt', aiDraft: drafts[field], field });
      }
    }
    await onConfirm();
  };

  return (
    <section
      aria-label={m.creative_brief_aria()}
      className="space-y-4"
      data-testid="creative-brief-editor"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={brief?.confirmedAt ? 'secondary' : 'outline'}>
            {brief?.confirmedAt
              ? m.creative_brief_confirmed()
              : m.creative_brief_unconfirmed()}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.creative_brief_description()}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {BRIEF_FIELDS.map(([field, label]) => {
          const saved = brief?.fields[field];
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
                    ? m.creative_brief_owner_merchant()
                    : saved?.owner === 'ai'
                      ? m.creative_brief_owner_ai()
                      : m.creative_brief_owner_pending()}
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{m.creative_brief_ai_draft()}</p>
                <p className="whitespace-pre-wrap text-foreground">
                  {saved?.aiDraft ?? drafts[field]}
                </p>
              </div>
              {isEditing ? (
                <Textarea
                  aria-label={m.creative_brief_edit_aria({ field: label() })}
                  disabled={busy}
                  onChange={(event) =>
                    setEditingValue(event.currentTarget.value)
                  }
                  value={editingValue}
                />
              ) : (
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>{m.creative_brief_current()}</p>
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
                    {m.creative_brief_adopt_ai()}
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
                    {m.creative_brief_save_edit()}
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
                    {m.creative_brief_edit()}
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
                    {m.creative_brief_revert_ai()}
                  </Button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {brief?.confirmedAt ? (
        <p aria-live="polite" className="text-sm font-medium text-primary">
          {m.creative_brief_confirmed_hint()}
        </p>
      ) : (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="mb-3 text-sm text-muted-foreground">
            {m.creative_brief_confirm_hint()}
          </p>
          <Button
            disabled={busy}
            onClick={() => void confirmBrief()}
            type="button"
          >
            {m.creative_brief_confirm()}
          </Button>
        </div>
      )}
    </section>
  );
}
