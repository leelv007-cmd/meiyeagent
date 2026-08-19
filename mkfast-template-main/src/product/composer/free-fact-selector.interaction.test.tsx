import type { StoreFact } from '@meiye/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import {
  FreeFactSelector,
  currentSelectedFreeFactRefs,
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
