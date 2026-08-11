import { MemoryConfirmationAuthorityStore } from './execution-confirmation-authority-store.js';
import { runConfirmationAuthorityStoreConformance } from './execution-confirmation-authority-conformance.js';

runConfirmationAuthorityStoreConformance({
  label: 'memory confirmation authority store',
  createFixture: async () => ({
    store: new MemoryConfirmationAuthorityStore(),
    // The memory ledger uses a null transaction client by convention.
    withTransaction: async (body) => body(null),
    dispose: async () => {},
  }),
});
