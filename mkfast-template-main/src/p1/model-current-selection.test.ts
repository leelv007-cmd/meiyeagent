import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CatalogModelView } from './settings-view-model';
import { resolveCreationModelSelection } from './model-current-selection';

function model(id: string): CatalogModelView {
  return {
    availabilityKind: 'production',
    available: true,
    capabilityLabels: ['文案生成'],
    displayName: id,
    id,
    modality: 'llm',
    qualityRank: 1,
    unitPrice: {
      amountMicros: 1_000,
      currency: 'CNY',
      revision: 'price-v1',
      unit: 'request',
    },
  };
}

describe('creation model selection', () => {
  it('uses an available current selection even when it is not the first catalog item', () => {
    const first = model('catalog-first');
    const selected = model('user-picked-second');

    assert.deepEqual(
      resolveCreationModelSelection({
        catalog: [first, selected],
        currentSelection: selected.id,
        userDefault: first.id,
      }),
      { model: selected, source: 'current_selection' }
    );
  });

  it('falls through an unavailable current selection to the user default', () => {
    const first = model('catalog-first');
    const userDefault = model('personal-default-second');

    assert.deepEqual(
      resolveCreationModelSelection({
        catalog: [first, userDefault],
        currentSelection: 'retired-selection',
        userDefault: userDefault.id,
      }),
      { model: userDefault, source: 'user_default' }
    );
  });

  it('uses the workspace default when there is no current or user selection', () => {
    const otherModel = model('catalog-first');
    const workspaceDefault = model('workspace-default-second');

    assert.deepEqual(
      resolveCreationModelSelection({
        catalog: [otherModel, workspaceDefault],
        workspaceDefault: workspaceDefault.id,
      }),
      { model: workspaceDefault, source: 'workspace_default' }
    );
  });

  it('requires an explicit selection when all configured choices are invalid', () => {
    const unavailable = { ...model('not-executable'), available: false };
    const unselectedExecutable = model('first-executable');

    assert.equal(
      resolveCreationModelSelection({
        catalog: [unavailable, unselectedExecutable],
        currentSelection: unavailable.id,
        userDefault: 'missing-personal-default',
        workspaceDefault: 'missing-workspace-default',
      }),
      undefined
    );
  });
});
