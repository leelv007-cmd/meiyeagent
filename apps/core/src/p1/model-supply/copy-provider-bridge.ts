import type {
  DataClass,
  ModelSupplyApplicationService,
  ProviderCost,
  ProductUsage,
  RequestedSelection,
  RouteSnapshot,
} from './index.js';

export interface ProductCopyProviderRequest {
  workspaceId: string;
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  requestedSelection: RequestedSelection;
  dataClass: DataClass[];
  prompt: string;
  promptRevision: string;
  exampleSetRevision: string;
}

export interface ProductCopyProviderEvidence {
  correlationId: string;
  requestedSelection: RequestedSelection;
  actualCatalogModelId: string;
  routeSnapshot: RouteSnapshot;
  promptRevision: string;
  exampleSetRevision: string;
  usage: ProductUsage;
  providerCost: ProviderCost;
}

/**
 * Stable bridge for ProductService. It owns no transaction and deliberately
 * returns all evidence needed for the caller's short commit/refund transaction.
 */
export class ProductCopyProviderBridge {
  constructor(
    private readonly models: ModelSupplyApplicationService,
    private readonly beforeSubmit?: (workspaceId: string) => Promise<void>,
  ) {}

  async generate(request: ProductCopyProviderRequest) {
    await this.beforeSubmit?.(request.workspaceId);
    const result = await this.models.submit({
      workspaceId: request.workspaceId,
      actorId: request.actorId,
      idempotencyKey: request.idempotencyKey,
      operation: 'copy.generate',
      selection: request.requestedSelection,
      dataClass: [...request.dataClass],
      prompt: request.prompt,
      promptRevision: request.promptRevision,
      exampleSetRevision: request.exampleSetRevision,
    });
    if (result.status !== 'completed' || !result.copyCandidates) {
      throw new Error(`Copy provider returned ${result.status}; the caller must reconcile the job.`);
    }
    return {
      candidates: result.copyCandidates,
      evidence: {
        correlationId: request.correlationId,
        requestedSelection: { ...request.requestedSelection },
        actualCatalogModelId: result.snapshot.actualCatalogModelId,
        routeSnapshot: result.snapshot,
        promptRevision: request.promptRevision,
        exampleSetRevision: request.exampleSetRevision,
        usage: result.usage,
        providerCost: result.providerCost,
      } satisfies ProductCopyProviderEvidence,
    };
  }
}
