import { expect, type Page } from '@playwright/test';

/**
 * Day-0 contract counter for metric "用户激活次数".
 *
 * Counts only top-level, isTrusted, primary-button clicks via a page capture
 * layer (not Playwright `.click()` call sites). Cmd/Ctrl+Enter keyboard submit
 * also counts as one activation. Measurement must be cleared after seed prep
 * and stopped at the first usable draft token (`[data-has-token="true"]`).
 */

export type UserActivationKind = 'click' | 'keyboard_submit';

export interface UserActivationEvent {
  at: number;
  kind: UserActivationKind;
  targetLabel?: string;
}

export interface UserActivationCounter {
  /** Clear and start counting (call after seed prep completes). */
  beginMeasurement: () => void;
  /** Freeze counting (call once first token is observed). */
  stop: () => void;
  /** Current activation count while measuring or after stop. */
  count: () => number;
  events: () => UserActivationEvent[];
  /** Wait for first token endpoint then stop and return the count. */
  waitForFirstTokenAndStop: (options?: { timeout?: number }) => Promise<number>;
}

declare global {
  interface Window {
    __e2eRecordUserActivation?: (
      kind: UserActivationKind,
      targetLabel?: string
    ) => void;
    __e2eUserActivationCaptureInstalled?: boolean;
  }
}

export async function installUserActivationCounter(
  page: Page
): Promise<UserActivationCounter> {
  let measuring = false;
  let stopped = false;
  let events: UserActivationEvent[] = [];

  await page.exposeBinding(
    '__e2eRecordUserActivation',
    (_source, kind: UserActivationKind, targetLabel?: string) => {
      if (!measuring || stopped) return;
      if (kind !== 'click' && kind !== 'keyboard_submit') return;
      events.push({
        at: Date.now(),
        kind,
        ...(targetLabel ? { targetLabel } : {}),
      });
    }
  );

  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (window.__e2eUserActivationCaptureInstalled) return;
    window.__e2eUserActivationCaptureInstalled = true;

    const targetLabel = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return undefined;
      const control = target.closest(
        'button, [role="button"], a, input, textarea'
      );
      if (!(control instanceof HTMLElement)) return undefined;
      return (
        control.getAttribute('aria-label') ??
        control.textContent?.trim() ??
        control.id
      )
        ?.replace(/\s+/gu, ' ')
        .slice(0, 160);
    };

    // Capture phase on the top-level window only (no iframe listeners).
    window.addEventListener(
      'click',
      (event) => {
        if (!event.isTrusted) return;
        if (event.button !== 0) return;
        void window.__e2eRecordUserActivation?.(
          'click',
          targetLabel(event.target)
        );
      },
      true
    );

    window.addEventListener(
      'keydown',
      (event) => {
        if (!event.isTrusted) return;
        if (event.key !== 'Enter') return;
        if (!(event.metaKey || event.ctrlKey)) return;
        void window.__e2eRecordUserActivation?.(
          'keyboard_submit',
          targetLabel(event.target)
        );
      },
      true
    );
  });

  return {
    beginMeasurement() {
      events = [];
      measuring = true;
      stopped = false;
    },
    stop() {
      stopped = true;
    },
    count() {
      return events.length;
    },
    events() {
      return [...events];
    },
    async waitForFirstTokenAndStop(options = {}) {
      await expect(page.locator('[data-has-token="true"]').first()).toBeVisible(
        {
          timeout: options.timeout ?? 60_000,
        }
      );
      stopped = true;
      return events.length;
    },
  };
}

/**
 * Canonical Day-0 submit button (zh locale).
 *
 * The accessible name states which of the control's two jobs the next press
 * does, so it is 开始创作 only once every precondition is closed; while one is
 * open it names the thing the press will actually open instead.
 */
export function composerSubmitButton(page: Page) {
  return page.getByRole('button', {
    name: /开始创作|建立创作记录|先补门店信息|先补资质信息|先确认素材来源/,
  });
}

/**
 * D-081 / D-098 C6 lens (creation-mode) selector chips on the current surface.
 * Current shipped chips: 做图文 | 做视频 (做文案 lands with new Composer).
 * Required mode select is a mode selector — NOT a forbidden pre-form — and
 * occupies one of the two-click Day-0 budget slots.
 */
export function composerLensOption(
  page: Page,
  mode: 'image_text' | 'video' | 'copy'
) {
  return page.getByTestId(`composer-lens-option-${mode}`);
}

/**
 * Primary scene / template card on the entry surface.
 * Per D-098 C6 the card click is dual-purpose (select lens + apply recipe) and
 * counts as exactly 1 activation toward the 2-click budget.
 */
export function composerRecipeCard(page: Page) {
  return page.getByTestId('composer-recipe-card-recipe.project_intro');
}

/** D-094 / D-043 decision ③ conditional Brief confirm (video / high-cost). */
export function briefConfirmButton(page: Page) {
  return page.getByTestId('composer-brief-confirm');
}

export function skipOnboardingButton(page: Page) {
  return page.getByRole('button', { name: '暂时跳过' });
}

export function firstTokenLocator(page: Page) {
  return page.locator('[data-has-token="true"]').first();
}

export function blockingQuestionLocator(page: Page) {
  return page
    .getByText('只需确认一件事')
    .or(page.getByRole('heading', { name: /这次团购价按哪个金额写/ }));
}
