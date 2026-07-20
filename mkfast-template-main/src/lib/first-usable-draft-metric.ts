export type FirstDraftActivationPath = 'canonical_mouse' | 'keyboard';

export interface FirstUsableDraftMeasurementResult {
  path: FirstDraftActivationPath | 'conflict';
  timeToFirstUsableDraftMs: number;
  userActivationCount: number;
}

export class FirstUsableDraftMeasurement {
  private activationCount = 1;
  private conflictSeen = false;

  constructor(
    private readonly activationPath: FirstDraftActivationPath,
    private readonly startedAt: number
  ) {}

  recordActivation() {
    this.activationCount += 1;
  }

  markConflict() {
    this.conflictSeen = true;
  }

  finish(finishedAt: number): FirstUsableDraftMeasurementResult {
    return {
      path: this.conflictSeen ? 'conflict' : this.activationPath,
      timeToFirstUsableDraftMs: Math.max(
        0,
        Math.round(finishedAt - this.startedAt)
      ),
      userActivationCount: this.activationCount,
    };
  }
}

let activeMeasurement: FirstUsableDraftMeasurement | undefined;
let installed = false;
let lastActivation: { at: number; path: FirstDraftActivationPath } | undefined;

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** Install once before the composer can receive its submit activation. */
export function prepareFirstUsableDraftMeasurement() {
  if (typeof window === 'undefined' || installed || window !== window.top)
    return;
  installed = true;
  window.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || event.button !== 0) return;
      const at = now();
      if (activeMeasurement) activeMeasurement.recordActivation();
      lastActivation = { at, path: 'canonical_mouse' };
    },
    true
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted || event.key !== 'Enter') return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const at = now();
      if (activeMeasurement) activeMeasurement.recordActivation();
      lastActivation = { at, path: 'keyboard' };
    },
    true
  );
  new MutationObserver(() => {
    if (!activeMeasurement) return;
    if (document.querySelector('[data-question-id]')) {
      activeMeasurement.markConflict();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/** Start immediately from the trusted activation that invoked composer submit. */
export function beginFirstUsableDraftMeasurement() {
  prepareFirstUsableDraftMeasurement();
  const startedAt = now();
  const recent =
    lastActivation && startedAt - lastActivation.at <= 1_000
      ? lastActivation.path
      : 'canonical_mouse';
  activeMeasurement = new FirstUsableDraftMeasurement(recent, startedAt);
  if (document.querySelector('[data-question-id]')) {
    activeMeasurement.markConflict();
  }
}

export function cancelFirstUsableDraftMeasurement() {
  activeMeasurement = undefined;
}

export function finishFirstUsableDraftMeasurement() {
  if (!activeMeasurement) return undefined;
  const result = activeMeasurement.finish(now());
  activeMeasurement = undefined;
  return result;
}
