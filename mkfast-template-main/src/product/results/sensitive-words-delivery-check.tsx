import { useQuery } from '@tanstack/react-query';
import { sensitiveCheckBarSchema } from '@meiye/contracts';

import { boundedQueryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  DeliveryPanel,
  type DeliveryPanelProps,
  type DeliverySensitiveWordsCheckState,
} from './delivery-panel';

export type SensitiveWordsGuardedDeliveryPanelProps = Omit<
  DeliveryPanelProps,
  'sensitiveWordsCheck'
> & {
  /** null means the delivery text projection is unavailable: fail closed. */
  text: string | null;
};

export const SENSITIVE_WORDS_DELIVERY_CHECK_TIMEOUT_MS = 10_000;

export function SensitiveWordsGuardedDeliveryPanel({
  text,
  ...deliveryProps
}: SensitiveWordsGuardedDeliveryPanelProps) {
  const checkQuery = useQuery({
    queryKey: p1QueryKeys.request('sensitive-words', 'check_bar', {
      text: text ?? '',
    }),
    enabled: text !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await boundedQueryP1<unknown>(
        'sensitive-words',
        { action: 'check_bar', payload: { text: text ?? '' } },
        { signal, timeoutMs: SENSITIVE_WORDS_DELIVERY_CHECK_TIMEOUT_MS }
      );
      return sensitiveCheckBarSchema.parse(response);
    },
  });

  let sensitiveWordsCheck: DeliverySensitiveWordsCheckState;
  if (text === null) {
    sensitiveWordsCheck = { kind: 'failed' };
  } else if (checkQuery.isFetching) {
    sensitiveWordsCheck = { kind: 'checking' };
  } else if (checkQuery.isError) {
    sensitiveWordsCheck = {
      kind: 'failed',
      onRetry: () => {
        void checkQuery.refetch();
      },
    };
  } else if (checkQuery.data) {
    sensitiveWordsCheck = { kind: 'ready', checkBar: checkQuery.data };
  } else {
    sensitiveWordsCheck = { kind: 'checking' };
  }

  return (
    <DeliveryPanel
      {...deliveryProps}
      sensitiveWordsCheck={sensitiveWordsCheck}
    />
  );
}
