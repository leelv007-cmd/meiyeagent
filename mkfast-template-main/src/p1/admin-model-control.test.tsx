import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminModelControl } from './admin-model-control';
import { p1QueryKeys } from './query-keys';

test('shows the API family for a custom model deployment', () => {
  const queryClient = new QueryClient();
  const model = {
    activationEvidence: { status: 'recorded' },
    availability: 'recorded',
    dataClasses: { allowed: ['public'], denied: [] },
    displayName: 'Custom Copy Model',
    id: 'llm-custom',
    manufacturer: 'Merchant Provider',
    modality: 'llm',
    operations: ['copy.generate'],
    qualityRank: 80,
    stableModelName: 'custom-copy-v1',
    version: '1',
  };
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'admin_catalogs', {
      operations: [
        'copy.generate',
        'image.generate',
        'image.edit',
        'video.generate',
      ],
    }),
    [
      {
        id: 'copy.generate',
        value: {
          models: [model],
          revisionId: 'catalog-v1',
          stage: 'recorded',
        },
      },
      ...['image.generate', 'image.edit', 'video.generate'].map((id) => ({
        id,
        value: { models: [], revisionId: 'catalog-v1', stage: 'recorded' },
      })),
    ]
  );
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'admin_catalog_control'),
    {
      catalog: {
        capabilities: [],
        deployments: [
          {
            activationEvidence: { status: 'recorded' },
            apiFamily: 'custom',
            catalogModelId: 'llm-custom',
            channel: 'direct',
            id: 'llm-custom-direct',
            region: 'overseas',
            status: 'active',
          },
        ],
        executionChannels: [],
        models: [
          {
            displayName: 'Custom Copy Model',
            id: 'llm-custom',
            manufacturer: 'Merchant Provider',
            modality: 'llm',
            operations: ['copy.generate'],
            qualityRank: 80,
            stableModelName: 'custom-copy-v1',
            version: '1',
          },
        ],
        prices: [],
        providerProfiles: [],
        routes: [],
      },
      revisionId: 'catalog-v1',
      stage: 'recorded',
      workspaceId: 'workspace-a',
    }
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminModelControl />
    </QueryClientProvider>
  );

  assert.match(html, /API family<\/dt><dd>custom<\/dd>/u);
});
