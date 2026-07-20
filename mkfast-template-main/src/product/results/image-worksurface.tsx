/**
 * Image worksurface UI (WT-D2 / #100).
 *
 * Role-action primary · set tray · working selection controls ·
 * library actions · adjust prompt · exact role feedback live region.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useEffect, useMemo, useReducer, useState } from 'react';

import { AdjustPrompt } from './adjust-prompt';
import {
  projectImageWorksurface,
  type ImageWorksurfaceFacts,
} from './image-worksurface-model';
import {
  createEmptyWorkingSelection,
  isWorkingSelectionExpired,
  parseWorkingSelection,
  reduceWorkingSelection,
  serializeWorkingSelection,
  workingSelectionStorageKey,
  type WorkingSelectionIntent,
  type WorkingSelectionState,
} from './working-selection-reducer';

export type ImageWorksurfaceProps = {
  facts: Omit<ImageWorksurfaceFacts, 'workingSelection' | 'explicitMode'> & {
    workingSelection?: WorkingSelectionState;
    explicitMode?: 'single' | 'set';
  };
  onAdoptPrimary?: (
    actionKind: string,
    orderedAssetIds: string[]
  ) => void | Promise<void>;
  onSaveLibrary?: (
    kind: 'save_one' | 'save_selected',
    assetIds: string[]
  ) => void;
  onSaveDraft?: (selection: WorkingSelectionState) => void | Promise<void>;
  onAdjust?: (
    instruction: string,
    scope?:
      | { kind: 'asset'; assetId: string }
      | { kind: 'set'; assetIds: string[] }
  ) => void;
  onCreateFromThis?: () => void;
  onModeChange?: (mode: 'single' | 'set') => void;
};

type LocalState = {
  selection: WorkingSelectionState;
  feedback: string | null;
  focusedAssetId: string | undefined;
  modeOverride: 'single' | 'set' | undefined;
};

type LocalAction =
  | { type: 'intent'; intent: WorkingSelectionIntent }
  | { type: 'focus'; assetId: string }
  | { type: 'mode'; mode: 'single' | 'set' }
  | { type: 'feedback'; feedback: string | null };

function localReducer(state: LocalState, action: LocalAction): LocalState {
  switch (action.type) {
    case 'intent': {
      const result = reduceWorkingSelection(state.selection, action.intent);
      return {
        ...state,
        selection: result.state,
        feedback: result.feedback,
      };
    }
    case 'focus':
      return { ...state, focusedAssetId: action.assetId, feedback: null };
    case 'mode':
      return { ...state, modeOverride: action.mode, feedback: null };
    case 'feedback':
      return { ...state, feedback: action.feedback };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function ImageWorksurface(props: ImageWorksurfaceProps) {
  const emptySelection = () =>
    createEmptyWorkingSelection({
      workId: props.facts.workId,
      baseRevisionId: props.facts.baseRevisionId,
      now: new Date().toISOString(),
    });

  const [local, dispatch] = useReducer(
    localReducer,
    undefined,
    (): LocalState => {
      const supplied = props.facts.workingSelection;
      let selection = supplied ?? emptySelection();
      if (!supplied && typeof window !== 'undefined') {
        const key = workingSelectionStorageKey(props.facts.workId);
        const stored = parseWorkingSelection(
          window.localStorage.getItem(key) ?? ''
        );
        if (
          stored &&
          stored.workId === props.facts.workId &&
          stored.baseRevisionId === props.facts.baseRevisionId &&
          !isWorkingSelectionExpired(stored, new Date().toISOString())
        ) {
          selection = stored;
        } else if (
          stored &&
          isWorkingSelectionExpired(stored, new Date().toISOString())
        ) {
          window.localStorage.removeItem(key);
        }
      }
      return {
        selection,
        feedback: null,
        focusedAssetId: props.facts.focusedAssetId,
        modeOverride: props.facts.explicitMode,
      };
    }
  );
  const [adjustScope, setAdjustScope] = useState<'adjust_one' | 'adjust_set'>(
    props.facts.explicitMode === 'set' ? 'adjust_set' : 'adjust_one'
  );

  useEffect(() => {
    window.localStorage.setItem(
      workingSelectionStorageKey(props.facts.workId),
      serializeWorkingSelection(local.selection)
    );
  }, [local.selection, props.facts.workId]);

  const facts: ImageWorksurfaceFacts = useMemo(
    () => ({
      ...props.facts,
      workingSelection: local.selection,
      focusedAssetId: local.focusedAssetId ?? props.facts.focusedAssetId,
      explicitMode: local.modeOverride ?? props.facts.explicitMode,
    }),
    [props.facts, local.selection, local.focusedAssetId, local.modeOverride]
  );

  const view = projectImageWorksurface(facts, {
    lastFeedback: local.feedback,
  });

  const now = () => new Date().toISOString();

  return (
    <div
      className="space-y-4"
      data-testid="image-worksurface"
      data-mode={view.mode}
      data-lifecycle={props.facts.lifecycle}
    >
      {/* Exact role feedback — polite live region (D-087). */}
      <div
        aria-live="polite"
        className="sr-only"
        data-testid="image-role-feedback"
      >
        {view.feedback ?? ''}
      </div>
      {view.feedback ? (
        <p
          className="rounded-md bg-muted px-3 py-2 text-sm"
          data-testid="image-role-feedback-visible"
        >
          {view.feedback}
        </p>
      ) : null}

      {view.modeSwitchable ? (
        <div className="flex flex-wrap gap-2" data-testid="image-mode-switch">
          <Button
            type="button"
            size="sm"
            variant={view.mode === 'single' ? 'default' : 'outline'}
            data-testid="image-mode-single"
            onClick={() => {
              dispatch({ type: 'mode', mode: 'single' });
              props.onModeChange?.('single');
            }}
          >
            单图
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view.mode === 'set' ? 'default' : 'outline'}
            data-testid="image-mode-set"
            onClick={() => {
              dispatch({ type: 'mode', mode: 'set' });
              props.onModeChange?.('set');
            }}
          >
            套图
          </Button>
        </div>
      ) : null}

      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="image-candidate-grid"
      >
        {view.candidates.map((candidate) => (
          <button
            key={candidate.assetId}
            type="button"
            className={`rounded-lg border p-3 text-left ${
              candidate.isFocused ? 'ring-2 ring-primary' : ''
            }`}
            data-testid="image-candidate"
            data-asset-id={candidate.assetId}
            data-order={candidate.order}
            data-in-set={candidate.inWorkingSelection ? 'true' : 'false'}
            data-cover={candidate.isWorkingCover ? 'true' : 'false'}
            data-adopted={candidate.isAdopted ? 'true' : 'false'}
            aria-label={candidate.a11yName}
            onClick={() =>
              dispatch({ type: 'focus', assetId: candidate.assetId })
            }
          >
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant="outline">第 {candidate.order} 张</Badge>
              {candidate.isWorkingCover ? (
                <Badge data-testid="image-cover-badge">封面</Badge>
              ) : null}
              {candidate.isAdopted ? (
                <Badge data-testid="image-adopted-badge">已采用</Badge>
              ) : (
                <Badge variant="secondary">候选</Badge>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {candidate.a11yName}
            </p>
            {candidate.previewUrl ? (
              <img
                src={candidate.previewUrl}
                alt={candidate.a11yName}
                className="mt-2 aspect-[3/4] w-full rounded-md object-cover"
              />
            ) : (
              <div className="mt-2 flex aspect-[3/4] items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                {candidate.assetId}
              </div>
            )}
          </button>
        ))}
      </div>

      {view.mode === 'set' ? (
        <section
          className="space-y-2 rounded-lg border p-4"
          data-testid="image-set-tray"
        >
          <h3 className="text-sm font-medium">
            当前套图（{view.workingSlots.length} 张）
          </h3>
          {view.workingSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚未加入图片</p>
          ) : (
            <ol className="space-y-2">
              {view.workingSlots.map((slot) => (
                <li
                  key={slot.assetId}
                  className="flex flex-wrap items-center gap-2 text-sm"
                  data-testid="image-set-slot"
                  data-asset-id={slot.assetId}
                  data-order={slot.order}
                >
                  <span>
                    第 {slot.order} 张{slot.isCover ? ' · 封面' : ''}
                  </span>
                  <code className="text-xs">{slot.assetId}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="image-move-up"
                    aria-label={`前移第 ${slot.order} 张`}
                    onClick={() =>
                      dispatch({
                        type: 'intent',
                        intent: {
                          type: 'move_up',
                          assetId: slot.assetId,
                          now: now(),
                        },
                      })
                    }
                  >
                    前移
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="image-move-down"
                    aria-label={`后移第 ${slot.order} 张`}
                    onClick={() =>
                      dispatch({
                        type: 'intent',
                        intent: {
                          type: 'move_down',
                          assetId: slot.assetId,
                          now: now(),
                        },
                      })
                    }
                  >
                    后移
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="image-set-cover"
                    onClick={() =>
                      dispatch({
                        type: 'intent',
                        intent: {
                          type: 'set_cover',
                          assetId: slot.assetId,
                          now: now(),
                        },
                      })
                    }
                  >
                    设为封面
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid="image-remove"
                    onClick={() =>
                      dispatch({
                        type: 'intent',
                        intent: {
                          type: 'remove',
                          assetId: slot.assetId,
                          now: now(),
                        },
                      })
                    }
                  >
                    移除
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="image-save-draft"
              disabled={!props.onSaveDraft}
              onClick={() => props.onSaveDraft?.(local.selection)}
            >
              保存草稿
            </Button>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2" data-testid="image-primary-actions">
        {view.primaryAction ? (
          <Button
            type="button"
            data-testid="image-role-primary"
            data-action-kind={view.primaryAction.kind}
            disabled={
              view.primaryAction.kind !== 'add_to_set' && !props.onAdoptPrimary
            }
            onClick={async () => {
              const kind = view.primaryAction!.kind;
              if (kind === 'add_to_set' && local.focusedAssetId) {
                dispatch({
                  type: 'intent',
                  intent: {
                    type: 'add',
                    assetId: local.focusedAssetId,
                    now: now(),
                  },
                });
                return;
              }
              // Prefer working selection; fall back to full candidate order
              // when full set is ready and selection is still empty.
              const ordered =
                view.workingSelection.orderedAssetIds.length > 0
                  ? view.workingSelection.orderedAssetIds
                  : view.candidates.map((c) => c.assetId);
              if (!props.onAdoptPrimary) return;
              await props.onAdoptPrimary(kind, ordered);
              if (kind === 'adopt_set') {
                dispatch({
                  type: 'feedback',
                  feedback: `已采用这组，共 ${ordered.length} 张`,
                });
              } else if (kind === 'adopt_one') {
                dispatch({ type: 'feedback', feedback: '已采用这张图片' });
              } else if (kind === 'set_primary') {
                dispatch({ type: 'feedback', feedback: '已设为主图' });
              } else if (kind === 'set_cover') {
                dispatch({ type: 'feedback', feedback: '已设为封面' });
              } else if (kind === 'replace_item') {
                dispatch({
                  type: 'feedback',
                  feedback: '已替换，原版本仍可恢复',
                });
              }
            }}
          >
            {view.primaryAction.label}
          </Button>
        ) : null}

        {view.libraryActions.map((action) => (
          <Button
            key={action.kind}
            type="button"
            variant="outline"
            data-testid={`image-library-${action.kind}`}
            disabled={!props.onSaveLibrary}
            onClick={() => {
              if (!props.onSaveLibrary) return;
              if (action.kind === 'save_one') {
                props.onSaveLibrary('save_one', [action.assetId]);
              } else {
                props.onSaveLibrary('save_selected', action.assetIds);
              }
              dispatch({ type: 'feedback', feedback: '已在素材库' });
            }}
          >
            {action.label}
          </Button>
        ))}

        {view.createFromThis ? (
          <Button
            type="button"
            variant="outline"
            data-testid="image-create-from-this"
            disabled={!props.onCreateFromThis}
            onClick={() => props.onCreateFromThis?.()}
          >
            {view.createFromThis.label}
          </Button>
        ) : null}
      </div>

      {view.wholeSetAdopt?.kind === 'rejected' ? (
        <p
          className="text-sm text-destructive"
          data-testid="image-whole-set-reject"
          data-code={view.wholeSetAdopt.code}
        >
          {view.wholeSetAdopt.message}
        </p>
      ) : null}

      <AdjustPrompt
        onSubmit={(instruction) => {
          const focusedAssetId =
            local.focusedAssetId ?? props.facts.focusedAssetId;
          if (adjustScope === 'adjust_one' && focusedAssetId) {
            props.onAdjust?.(instruction, {
              assetId: focusedAssetId,
              kind: 'asset',
            });
            return;
          }
          const assetIds =
            local.selection.orderedAssetIds.length > 0
              ? [...local.selection.orderedAssetIds]
              : props.facts.candidates.map((candidate) => candidate.assetId);
          props.onAdjust?.(instruction, { assetIds, kind: 'set' });
        }}
        scopeActions={view.adjustPrompt.scopeActions}
        selectedScopeId={adjustScope}
        onScopeAction={(scope) =>
          setAdjustScope(scope === 'adjust_one' ? 'adjust_one' : 'adjust_set')
        }
      />

      <span data-testid="image-mobile-desktop-gate" hidden>
        {view.mobileDesktopGate}
      </span>
    </div>
  );
}
