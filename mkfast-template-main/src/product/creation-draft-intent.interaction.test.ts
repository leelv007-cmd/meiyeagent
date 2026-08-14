/**
 * V31-76: same-tab remix must overwrite. `storage` events never fire in the
 * writing tab, so writeCreationDraftIntent dispatches a custom event and the
 * composer listener applies replaceComposerDraftText.
 */
import { afterEach, expect, it } from 'vitest';

import { createComposerLensState } from './composer/lens-state-machine';
import {
  CREATION_DRAFT_INTENT_EVENT,
  CREATION_DRAFT_INTENT_STORAGE_KEY,
  exampleRemixIntent,
  readCreationDraftIntent,
  writeCreationDraftIntent,
} from './creation-entry-model';
import { replaceComposerDraftText } from './recommendation-handoff';

afterEach(() => {
  window.sessionStorage.clear();
});

it('second same-tab write overwrites storage and the listener-applied draft', () => {
  const first = exampleRemixIntent({
    industry: 'hair_care',
    platform: 'xiaohongshu',
    title: '一天不洗就塌，先看头皮还是先换洗发水',
  });
  const second = exampleRemixIntent({
    industry: 'hair_growth',
    platform: 'douyin',
    title: '养护要做多久才看得出来',
  });

  const details: string[] = [];
  const onCustom = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (typeof detail === 'string') details.push(detail);
  };
  window.addEventListener(CREATION_DRAFT_INTENT_EVENT, onCustom);

  expect(writeCreationDraftIntent(window.sessionStorage, first)).toBe(true);
  expect(writeCreationDraftIntent(window.sessionStorage, second)).toBe(true);

  window.removeEventListener(CREATION_DRAFT_INTENT_EVENT, onCustom);

  expect(window.sessionStorage.getItem(CREATION_DRAFT_INTENT_STORAGE_KEY)).toBe(
    second
  );
  expect(readCreationDraftIntent(window.sessionStorage)).toBe(second);
  expect(details).toEqual([first, second]);

  let lens = createComposerLensState();
  for (const intent of details) {
    lens = replaceComposerDraftText(lens, intent);
  }
  expect(lens.draft.userText).toBe(second);
  expect(lens.draft.userText).toMatch(/养发护理/);
  expect(lens.draft.userText).not.toMatch(/头皮护理/);
});
