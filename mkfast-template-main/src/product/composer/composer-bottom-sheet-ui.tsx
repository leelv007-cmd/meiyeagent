/**
 * Single-conflict bottom sheet host (C3 / #97, D-084).
 *
 * Only one sheet at a time. Used for conflict / reuse / tool_confirm.
 * Does not own business writes — pure presentation + dismiss restore.
 */

import { useEffect, useId, useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  dismissComposerSheet,
  type ComposerBottomSheetState,
  type ComposerSheetKind,
  type ComposerSheetRestoreSnapshot,
} from './composer-bottom-sheet';

export type ComposerBottomSheetProps = {
  state: ComposerBottomSheetState;
  onStateChange: (next: ComposerBottomSheetState) => void;
  /** Called after dismiss with the restore snapshot (scroll/focus/draft). */
  onRestore?: (restore: ComposerSheetRestoreSnapshot) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
};

const SHEET_TITLES: Record<ComposerSheetKind, string> = {
  conflict: '确认套用模板',
  reuse_panel: '旧内容换平台',
  tool_confirm: '确认使用工具',
};

export function ComposerBottomSheet({
  state,
  onStateChange,
  onRestore,
  title,
  children,
  className,
}: ComposerBottomSheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const open = state.open;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the sheet for keyboard / SR users.
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, state.generation]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismiss closes over latest state
  }, [open, state]);

  if (!open) return null;

  const handleDismiss = () => {
    const { state: next, restore } = dismissComposerSheet(state);
    onStateChange(next);
    if (restore) onRestore?.(restore);
  };

  const resolvedTitle = title ?? SHEET_TITLES[open];

  return (
    <div
      data-testid="composer-bottom-sheet-root"
      data-sheet-kind={open}
      data-sheet-generation={state.generation}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <button
        type="button"
        aria-label="关闭"
        data-testid="composer-bottom-sheet-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={handleDismiss}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="composer-bottom-sheet"
        data-sheet-kind={open}
        className={cn(
          'relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-input bg-background p-4 shadow-lg outline-none',
          className
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {resolvedTitle}
          </h2>
          <button
            type="button"
            data-testid="composer-bottom-sheet-close"
            className="min-h-12 min-w-12 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent/40"
            onClick={handleDismiss}
          >
            关闭
          </button>
        </div>
        <div
          data-testid="composer-bottom-sheet-body"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
