import type {
  ProductCommand,
  ProductContext,
} from '@meiye/contracts';
import {
  DomainError,
  type ProductApplicationService,
} from './product-service.js';
import {
  noOpLegacyInFlightDecisionPort,
  type LegacyInFlightDecisionPort,
} from './legacy-inflight-decision.js';

export interface ProductWriteOwnerReader {
  getCommandOwner?(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<'legacy' | 'p1' | null>;
  getFutureWriteOwner(
    workspaceId: string
  ): Promise<'legacy' | 'frozen' | 'p1'>;
}

const ownershipRaceCodes = new Set([
  'LEGACY_WRITE_DISABLED',
  'P1_WRITE_DISABLED',
]);

export class CutoverProductService implements ProductApplicationService {
  constructor(
    private readonly ownership: ProductWriteOwnerReader,
    private readonly legacy: ProductApplicationService,
    private readonly relational: ProductApplicationService,
    private readonly inFlightDecisions: LegacyInFlightDecisionPort =
      noOpLegacyInFlightDecisionPort
  ) {}

  async bootstrap(context: ProductContext) {
    const owner = await this.ownership.getFutureWriteOwner(context.workspaceId);
    return (owner === 'p1' ? this.relational : this.legacy).bootstrap(context);
  }

  async execute(
    context: ProductContext,
    command: ProductCommand,
    idempotencyKey: string
  ) {
    if ((context.actor ?? 'user') === 'worker' && 'jobId' in command) {
      const service = await this.workerService(context.workspaceId, command.jobId);
      return service.execute(context, command, idempotencyKey);
    }
    const commandOwner = await this.ownership.getCommandOwner?.(
      context.workspaceId,
      idempotencyKey
    );
    if (commandOwner) {
      return (commandOwner === 'p1' ? this.relational : this.legacy).execute(
        context,
        command,
        idempotencyKey
      );
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owner = await this.ownership.getFutureWriteOwner(
        context.workspaceId
      );
      const service = owner === 'p1' ? this.relational : this.legacy;
      try {
        return await service.execute(context, command, idempotencyKey);
      } catch (error) {
        if (
          attempt === 0 &&
          error instanceof DomainError &&
          ownershipRaceCodes.has(error.code)
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new DomainError(
      'WRITE_OWNER_UNSTABLE',
      'Product write ownership changed repeatedly while routing the command.',
      409
    );
  }

  async prepareVideoRender(context: ProductContext, jobId: string) {
    const service = await this.workerService(context.workspaceId, jobId);
    return service.prepareVideoRender(context, jobId);
  }

  private async workerService(workspaceId: string, jobId: string) {
    const decision = await this.inFlightDecisions.get(workspaceId, jobId);
    if (
      decision?.decision === 'legacy_drain' ||
      decision?.decision === 'manual'
    ) {
      return this.legacy;
    }
    const owner = await this.ownership.getFutureWriteOwner(workspaceId);
    return owner === 'p1' ? this.relational : this.legacy;
  }
}
