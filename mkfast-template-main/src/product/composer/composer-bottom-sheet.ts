/**
 * Single-conflict bottom sheet mutex (C3 / #97, D-084).
 *
 * Mobile may host at most ONE bottom sheet at a time for:
 * 1. RecipePatchPreview conflict confirm
 * 2. 旧内容换平台 source/form/carrier panel
 * 3. One-step narrow tool confirm
 *
 * Nested sheets forbidden. Drawer elsewhere remains admin/user menu only.
 * Dismiss (back / Escape / swipe / cancel) restores draft + scroll + focus.
 */

export const COMPOSER_SHEET_KINDS = [
  'conflict',
  'reuse_panel',
  'tool_confirm',
] as const;

export type ComposerSheetKind = (typeof COMPOSER_SHEET_KINDS)[number];

export type ComposerSheetRestoreSnapshot = {
  /** Scroll position of the host page to restore on dismiss. */
  scrollY: number;
  /** Focus target id / test id to restore on dismiss. */
  focusKey: string | null;
  /** Opaque draft key — sheet never mutates the draft itself. */
  draftKey: string | null;
};

export type ComposerBottomSheetState = {
  /** Currently open sheet kind, or null when closed. */
  open: ComposerSheetKind | null;
  /** Snapshot captured when the sheet opened — used on dismiss. */
  restore: ComposerSheetRestoreSnapshot | null;
  /**
   * Monotonic token so hosts can detect open→close cycles.
   * Also used to assert mutex (only one open payload).
   */
  generation: number;
};

export function createComposerBottomSheetState(): ComposerBottomSheetState {
  return {
    open: null,
    restore: null,
    generation: 0,
  };
}

export type OpenSheetInput = {
  kind: ComposerSheetKind;
  scrollY?: number;
  focusKey?: string | null;
  draftKey?: string | null;
};

/**
 * Open a sheet. If another sheet is already open, it is replaced
 * (mutex — never stacks). Restore snapshot is taken from the new open call.
 */
export function openComposerSheet(
  state: ComposerBottomSheetState,
  input: OpenSheetInput
): ComposerBottomSheetState {
  return {
    open: input.kind,
    restore: {
      scrollY: input.scrollY ?? 0,
      focusKey: input.focusKey ?? null,
      draftKey: input.draftKey ?? null,
    },
    generation: state.generation + 1,
  };
}

/**
 * Dismiss the open sheet and return the restore snapshot for the host.
 * Idempotent when already closed.
 */
export function dismissComposerSheet(state: ComposerBottomSheetState): {
  state: ComposerBottomSheetState;
  restore: ComposerSheetRestoreSnapshot | null;
} {
  if (state.open === null) {
    return { state, restore: null };
  }
  return {
    state: {
      open: null,
      restore: null,
      generation: state.generation + 1,
    },
    restore: state.restore,
  };
}

/** True when any sheet is open (global mutex occupied). */
export function isComposerSheetOpen(state: ComposerBottomSheetState): boolean {
  return state.open !== null;
}

/**
 * Map recipe-apply phase → sheet kind.
 * idle/applied → no sheet; confirming → conflict; reuse_panel → reuse.
 */
export function sheetKindForApplyPhase(
  phase: 'idle' | 'confirming' | 'reuse_panel' | 'applied' | string
): ComposerSheetKind | null {
  if (phase === 'confirming') return 'conflict';
  if (phase === 'reuse_panel') return 'reuse_panel';
  return null;
}

/**
 * Sync sheet mutex from an apply session phase.
 * Opens the matching sheet when phase requires it; dismisses when phase clears.
 * Preserves restore snapshot across open if already same kind.
 */
export function syncSheetWithApplyPhase(
  state: ComposerBottomSheetState,
  phase: 'idle' | 'confirming' | 'reuse_panel' | 'applied' | string,
  restoreHints: {
    scrollY?: number;
    focusKey?: string | null;
    draftKey?: string | null;
  } = {}
): ComposerBottomSheetState {
  const desired = sheetKindForApplyPhase(phase);
  if (desired === null) {
    if (state.open === null) return state;
    return dismissComposerSheet(state).state;
  }
  if (state.open === desired) return state;
  return openComposerSheet(state, {
    kind: desired,
    scrollY: restoreHints.scrollY,
    focusKey: restoreHints.focusKey,
    draftKey: restoreHints.draftKey,
  });
}

/** Assert only one sheet kind can be open (mutex invariant). */
export function assertSingleSheetMutex(state: ComposerBottomSheetState): void {
  if (state.open !== null && !COMPOSER_SHEET_KINDS.includes(state.open)) {
    throw new Error(`Unknown sheet kind: ${state.open}`);
  }
  // Structural invariant: open is a single value, never a list — type-enforced.
  // Runtime check for hosts that serialize state loosely:
  if (Array.isArray((state as { open?: unknown }).open)) {
    throw new Error('Composer bottom sheet mutex violated: multiple open');
  }
}
