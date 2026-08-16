/**
 * Lives here rather than in product-service.ts so that legacy-billing-ledger.ts
 * can throw it without importing the service that imports the ledger.
 * product-service.ts re-exports it, so every existing importer is unaffected.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}
