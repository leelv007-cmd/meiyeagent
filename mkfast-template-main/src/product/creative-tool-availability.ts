import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { m } from '@/locale/paraglide/messages';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  normalizeCatalog,
  type ModelOperation,
} from '@/p1/settings-view-model';

export interface CreativeToolAvailability {
  available: boolean;
  unavailableReason?: string;
}

export type CreativeToolAvailabilityMap = Partial<
  Record<ModelOperation, CreativeToolAvailability>
>;

export function toolAvailabilityForCatalog(
  operation: ModelOperation,
  catalog: unknown,
  status: 'error' | 'pending' | 'success'
): CreativeToolAvailability {
  if (status === 'pending') {
    return {
      available: false,
      unavailableReason: m.creative_tool_availability_pending(),
    };
  }
  if (status === 'error') {
    return {
      available: false,
      unavailableReason: m.creative_tool_availability_error(),
    };
  }
  const models = normalizeCatalog(catalog ?? {}, operation).models;
  if (models.some((model) => model.available && model.unitPrice)) {
    return { available: true };
  }
  if (models.some((model) => model.available)) {
    return {
      available: false,
      unavailableReason: m.creative_tool_availability_quote_missing(),
    };
  }
  return {
    available: false,
    unavailableReason:
      models.find((model) => model.unavailableReason)?.unavailableReason ??
      m.creative_tool_availability_empty(),
  };
}

function useOperationCatalog(operation: ModelOperation, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: p1QueryKeys.request('model-supply', 'catalog', { operation }),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'model-supply',
        { action: 'catalog', payload: { operation } },
        signal
      ),
  });
}

export function useCreativeToolAvailability(enabled = true) {
  const copy = useOperationCatalog('copy.generate', enabled);
  const image = useOperationCatalog('image.generate', enabled);
  const video = useOperationCatalog('video.generate', enabled);
  const availability = useMemo(
    () =>
      ({
        'copy.generate': toolAvailabilityForCatalog(
          'copy.generate',
          copy.data,
          copy.status
        ),
        'image.generate': toolAvailabilityForCatalog(
          'image.generate',
          image.data,
          image.status
        ),
        'video.generate': toolAvailabilityForCatalog(
          'video.generate',
          video.data,
          video.status
        ),
      }) satisfies CreativeToolAvailabilityMap,
    [copy.data, copy.status, image.data, image.status, video.data, video.status]
  );
  const refetch = useCallback(
    () => Promise.all([copy.refetch(), image.refetch(), video.refetch()]),
    [copy.refetch, image.refetch, video.refetch]
  );
  return { availability, refetch };
}
