import type { StoreFact } from '@meiye/contracts';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import {
  FreeFactSelector,
  currentSelectedFreeFactRefs,
  freeFactSelectionOwnerKey,
  useOwnedFreeFactSelection,
} from './free-fact-selector';

const FACTS = [
  fact('service-main', 3, 'service', '水光护理'),
  fact('price-main', 4, 'price', '299 元'),
];

test('free fact selector starts empty and sends only the merchant-checked fact', async () => {
  const onSelectionChange = vi.fn();
  const user = userEvent.setup();
  render(
    <FreeFactSelector
      facts={FACTS}
      onSelectionChange={onSelectionChange}
      selectedRefs={[]}
    />
  );

  expect(screen.getByText('本次要引用的门店资料（可选）')).toBeVisible();
  expect(
    screen.getByText('来自你已确认的门店资料，仅勾选项会用于这次自由创作。')
  ).toBeVisible();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  expect(screen.getAllByRole('checkbox')[1]).not.toBeChecked();

  await user.click(screen.getByRole('checkbox', { name: /水光护理/u }));

  expect(onSelectionChange).toHaveBeenLastCalledWith([
    'store_fact:service-main:3',
  ]);
  expect(screen.getByText(/来源：门店已确认资料 · 第 3 版/u)).toBeVisible();
});

test('submission projection keeps selected refs only while their active head is visible', () => {
  expect(
    currentSelectedFreeFactRefs(
      ['store_fact:service-main:3', 'store_fact:stale:1'],
      FACTS
    )
  ).toEqual(['store_fact:service-main:3']);
  expect(currentSelectedFreeFactRefs([], FACTS)).toEqual([]);
});

test('workspace/account/thread tuple change destroys A selection before B can submit', () => {
  const ownerA = freeFactSelectionOwnerKey({
    accountId: 'account-a',
    workspaceId: 'workspace-a',
    threadId: 'thread-a',
    creationMode: 'free',
  });
  const ownerB = freeFactSelectionOwnerKey({
    accountId: 'account-b',
    workspaceId: 'workspace-b',
    threadId: 'thread-b',
    creationMode: 'free',
  });
  const view = renderHook(
    ({ ownerKey }) => useOwnedFreeFactSelection(ownerKey),
    { initialProps: { ownerKey: ownerA } }
  );
  act(() => view.result.current.setSelectedRefs(['store_fact:service-main:3']));
  expect(view.result.current.selectedRefs).toEqual([
    'store_fact:service-main:3',
  ]);

  view.rerender({ ownerKey: ownerB });
  expect(view.result.current.selectedRefs).toEqual([]);
  view.rerender({ ownerKey: ownerA });
  expect(view.result.current.selectedRefs).toEqual([]);
});

test('free to customized to free never revives the prior free selection', () => {
  const owner = (creationMode: 'free' | 'customized') =>
    freeFactSelectionOwnerKey({
      accountId: 'account-a',
      workspaceId: 'workspace-a',
      threadId: 'thread-a',
      creationMode,
    });
  const view = renderHook(
    ({ ownerKey }) => useOwnedFreeFactSelection(ownerKey),
    { initialProps: { ownerKey: owner('free') } }
  );
  act(() => view.result.current.setSelectedRefs(['store_fact:service-main:3']));

  view.rerender({ ownerKey: owner('customized') });
  expect(view.result.current.selectedRefs).toEqual([]);
  view.rerender({ ownerKey: owner('free') });
  expect(view.result.current.selectedRefs).toEqual([]);
});

function fact(
  factId: string,
  revision: number,
  kind: StoreFact['kind'],
  value: string
): StoreFact {
  return {
    factId,
    workspaceId: 'workspace-1',
    kind,
    key: factId,
    value,
    scope: { storeId: 'workspace-1' },
    source: {
      kind: 'user_confirmation',
      referenceId: `source-${factId}`,
      capturedAt: '2026-08-20T00:00:00.000Z',
    },
    effectiveFrom: '2026-08-20T00:00:00.000Z',
    expiresAt: null,
    revision,
    recordedAt: '2026-08-20T00:00:00.000Z',
    recordedBy: 'owner-1',
  };
}
