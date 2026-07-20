import type { Pool } from 'pg';

import { AssistedReceiptService } from './assisted-receipt-service.js';
import { PostgresCanonicalAssistedReceiptRepository } from './assisted-canonical-repository.js';
import {
  ResultDeliveryProjectionService,
  type ResultDeliveryOperationsReader,
  type ResultDeliveryPendingActionsReader,
} from './result-delivery-projection-service.js';

/**
 * Durable production assembly for ResultDeliveryFoundationModule options.
 * Keeps assisted state in Postgres and derives resolver/Recent/inbox directly
 * from Operations + PendingActions truth (no parallel result/notification table).
 */
export async function createDurableResultDeliveryRuntime(input: {
  pool: Pool;
  operations: ResultDeliveryOperationsReader;
  pendingActions: ResultDeliveryPendingActionsReader;
}) {
  const repository = new PostgresCanonicalAssistedReceiptRepository(input.pool);
  await repository.migrate();
  return {
    assistedReceipts: new AssistedReceiptService(repository),
    projections: new ResultDeliveryProjectionService(
      input.operations,
      input.pendingActions,
    ),
  };
}

export type DurableResultDeliveryRuntime = Awaited<
  ReturnType<typeof createDurableResultDeliveryRuntime>
>;
