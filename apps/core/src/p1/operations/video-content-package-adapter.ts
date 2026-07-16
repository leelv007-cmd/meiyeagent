import type {
  VideoContentPackageConfirmation,
  VideoContentPackageOutcome,
  VideoContentPackagePort,
} from '../video-content-package-port.js';
import type { OperationsApplicationService } from './application-service.js';

export class OperationsVideoContentPackageAdapter
  implements VideoContentPackagePort
{
  constructor(
    private readonly service: () => OperationsApplicationService
  ) {}

  async confirm(input: VideoContentPackageConfirmation) {
    await this.service().confirmVideoContentPackage(
      {
        actor: 'owner',
        correlationId: `video-content-package:${input.workflowId}:confirm`,
        userId: input.actorId,
        workspaceId: input.workspaceId,
      },
      input
    );
  }

  async reconcile(input: VideoContentPackageOutcome) {
    await this.service().reconcileVideoContentPackage(
      {
        actor: 'worker',
        correlationId: `video-content-package:${input.workflowId}:${input.status}`,
        userId: input.actorId,
        workspaceId: input.workspaceId,
      },
      input
    );
  }
}
