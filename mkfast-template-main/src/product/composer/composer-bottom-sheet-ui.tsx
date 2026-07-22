/**
 * Single-conflict bottom sheet host (C3 / #97, D-084).
 *
 * Only one sheet at a time. Used for conflict / reuse / tool_confirm.
 * Does not own business writes — pure presentation + dismiss restore.
 */

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useId } from 'react';

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
  const open = state.open;

  const handleDismiss = () => {
    const { state: next, restore } = dismissComposerSheet(state);
    onStateChange(next);
    if (restore) onRestore?.(restore);
  };

  if (!open) return null;

  const resolvedTitle = title ?? SHEET_TITLES[open];

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleDismiss();
      }}
    >
      <DialogContent
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="composer-bottom-sheet"
        data-sheet-kind={open}
        data-sheet-generation={state.generation}
        data-product-modal="composer-bottom-sheet"
        finalFocus={() => {
          const focusKey = state.restore?.focusKey;
          return focusKey
            ? (document.getElementById(focusKey) ?? false)
            : false;
        }}
        showCloseButton={false}
        className={cn(
          'meiye-product-shell top-auto right-0 bottom-0 left-0 z-50 mx-auto flex max-h-[85vh] w-full max-w-lg translate-x-0 translate-y-0 flex-col rounded-t-2xl border border-input bg-popover p-4 shadow-lg',
          className
        )}
      >
        <DialogHeader className="mb-3 flex-row items-center justify-between gap-2">
          <DialogTitle
            id={titleId}
            className="text-base font-semibold text-foreground"
          >
            {resolvedTitle}
          </DialogTitle>
          <DialogClose
            data-testid="composer-bottom-sheet-close"
            className="min-h-12 min-w-12 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent/40"
          >
            关闭
          </DialogClose>
        </DialogHeader>
        <div
          data-testid="composer-bottom-sheet-body"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
