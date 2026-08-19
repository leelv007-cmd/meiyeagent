import { STORE_FACT_KIND_LABELS, type StoreFact } from '@meiye/contracts';
import { useCallback, useEffect, useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export type FreeFactSelectorProps = {
  facts: StoreFact[];
  selectedRefs: string[];
  onSelectionChange: (refs: string[]) => void;
};

export type FreeFactSelectionOwner = {
  accountId: string | null;
  workspaceId: string | null;
  threadId: string | null;
  creationMode: 'customized' | 'free';
};

export function freeFactSelectionOwnerKey(
  owner: FreeFactSelectionOwner
): string {
  return JSON.stringify([
    owner.accountId,
    owner.workspaceId,
    owner.threadId,
    owner.creationMode,
  ]);
}

/**
 * A selection belongs to one account/workspace/thread/mode tuple. Mismatched
 * refs are hidden synchronously, then destroyed so returning cannot revive
 * them.
 */
export function useOwnedFreeFactSelection(ownerKey: string) {
  const [owned, setOwned] = useState<{ ownerKey: string; refs: string[] }>(
    () => ({
      ownerKey,
      refs: [],
    })
  );
  const selectedRefs = owned.ownerKey === ownerKey ? owned.refs : [];

  useEffect(() => {
    setOwned((current) =>
      current.ownerKey === ownerKey ? current : { ownerKey, refs: [] }
    );
  }, [ownerKey]);

  const setSelectedRefs = useCallback(
    (refs: string[]) => setOwned({ ownerKey, refs: [...refs] }),
    [ownerKey]
  );
  const clearSelectedRefs = useCallback(
    () => setOwned({ ownerKey, refs: [] }),
    [ownerKey]
  );

  return { selectedRefs, setSelectedRefs, clearSelectedRefs };
}

export function storeFactRevisionRef(
  fact: Pick<StoreFact, 'factId' | 'revision'>
): string {
  return `store_fact:${fact.factId}:${fact.revision}`;
}

/**
 * Keep the merchant's explicit choices only while that exact active head is
 * visible. This removes stale choices; it never auto-selects loaded facts.
 */
export function currentSelectedFreeFactRefs(
  selectedRefs: readonly string[],
  facts: ReadonlyArray<Pick<StoreFact, 'factId' | 'revision'>>
): string[] {
  const active = new Set(facts.map(storeFactRevisionRef));
  return selectedRefs.filter((reference) => active.has(reference));
}

export function FreeFactSelector({
  facts,
  selectedRefs,
  onSelectionChange,
}: FreeFactSelectorProps) {
  if (facts.length === 0) return null;
  const current = currentSelectedFreeFactRefs(selectedRefs, facts);

  return (
    <fieldset
      className="mb-2 rounded-2xl border border-border/60 bg-background/80 p-3"
      data-testid="free-fact-selector"
    >
      <legend className="px-1 text-sm font-medium text-foreground">
        本次要引用的门店资料（可选）
      </legend>
      <p className="mb-2 text-xs text-muted-foreground">
        来自你已确认的门店资料，仅勾选项会用于这次自由创作。
      </p>
      <ul className="space-y-2">
        {facts.map((fact) => {
          const reference = storeFactRevisionRef(fact);
          const checked = current.includes(reference);
          const id = `free-fact-${fact.factId}-${fact.revision}`;
          return (
            <li
              className="flex items-start gap-2"
              data-fact-ref={reference}
              key={reference}
            >
              <Checkbox
                aria-label={factLabel(fact)}
                checked={checked}
                id={id}
                onCheckedChange={(value) =>
                  onSelectionChange(
                    value === true
                      ? [...current, reference]
                      : current.filter((item) => item !== reference)
                  )
                }
              />
              <div className="min-w-0">
                <Label className="text-sm text-foreground" htmlFor={id}>
                  {factLabel(fact)}
                </Label>
                <p className="text-xs text-muted-foreground">
                  来源：门店已确认资料 · 第 {fact.revision} 版
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function factLabel(fact: StoreFact): string {
  if (typeof fact.value === 'string' || typeof fact.value === 'number') {
    return `${STORE_FACT_KIND_LABELS[fact.kind]}：${fact.value}`;
  }
  if (
    fact.value &&
    typeof fact.value === 'object' &&
    !Array.isArray(fact.value)
  ) {
    const value = fact.value as Record<string, unknown>;
    if (typeof value.name === 'string' && value.name.trim()) {
      return `${STORE_FACT_KIND_LABELS[fact.kind]}：${value.name.trim()}`;
    }
    if (typeof value.amount === 'number') {
      return `${STORE_FACT_KIND_LABELS[fact.kind]}：${value.amount} 元`;
    }
  }
  return STORE_FACT_KIND_LABELS[fact.kind];
}
