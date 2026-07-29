import type { Pool, PoolClient } from 'pg';

import type {
  DueDeliveryClaim,
  DueDeliveryEligibility,
} from './worker.js';

export interface WorkspaceOwnerMembershipReader {
  hasOwnerMembership(workspaceId: string): Promise<boolean>;
}

export interface RestDayFactReader {
  isRestDay(workspaceId: string, businessDate: string): Promise<boolean>;
}

const NO_REST_DAY_FACTS: RestDayFactReader = {
  async isRestDay() {
    return false;
  },
};

export class PostgresWorkspaceOwnerMembershipReader
  implements WorkspaceOwnerMembershipReader
{
  constructor(private readonly database: Pick<Pool | PoolClient, 'query'>) {}

  async hasOwnerMembership(workspaceId: string) {
    const result = await this.database.query(
      `SELECT 1
         FROM workspaces workspace
         JOIN workspace_memberships membership
           ON membership.workspace_id = workspace.id
        WHERE workspace.id = $1
          AND membership.role = 'owner'
        LIMIT 1`,
      [workspaceId],
    );
    return result.rowCount === 1;
  }
}

/**
 * The current workspace schema has no separate lifecycle status. An existing
 * owner membership is therefore the available activation fact for v1 due
 * delivery; it is deliberately not presented as a durable "active" status.
 */
export class ProductionDueDeliveryEligibility
  implements DueDeliveryEligibility
{
  constructor(
    private readonly memberships: WorkspaceOwnerMembershipReader,
    private readonly restDays: RestDayFactReader = NO_REST_DAY_FACTS,
  ) {}

  async evaluate(claim: DueDeliveryClaim) {
    const workspaceActive = await this.memberships.hasOwnerMembership(
      claim.workspaceId,
    );
    if (!workspaceActive || claim.type !== 'daily_recommendation') {
      return { isRestDay: false, workspaceActive };
    }
    const businessDate =
      claim.businessDate ??
      (claim.payload.schemaVersion === 'daily-recommendation/v1'
        ? claim.payload.businessDate
        : '');
    return {
      isRestDay: await this.restDays.isRestDay(
        claim.workspaceId,
        businessDate,
      ),
      workspaceActive,
    };
  }
}
