/**
 * Ops Console P1 module (V31-22).
 * Admin action boundary for Release desk / Tool Policy / Kill Switch / audit.
 */

import type { QuickCheckTrace } from '../agent-session/quick-checks.js';
import type { P1Context } from '../foundation/domain.js';
import { P1DomainError } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { PublishHarnessReleaseInput } from '../harness/harness-release.js';
import type { OpsConsoleService } from './ops-console-service.js';
import type { AgentToolPolicyRevision } from './tool-policy.js';

function actionOf(input: Record<string, unknown>): string {
  const action = input.action;
  if (typeof action !== 'string' || action.length === 0) {
    throw new P1DomainError('INVALID_STATE', 'ops-console action is required.');
  }
  return action;
}

function payloadOf(input: Record<string, unknown>): Record<string, unknown> {
  const payload = input.payload;
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'ops-console payload must be an object.',
    );
  }
  return payload as Record<string, unknown>;
}

function writeMetaOf(payload: Record<string, unknown>): {
  reason: string;
  evidence: string | null;
  now?: string;
} {
  return {
    reason: typeof payload.reason === 'string' ? payload.reason : '',
    evidence:
      typeof payload.evidence === 'string' ? payload.evidence : null,
    now: typeof payload.now === 'string' ? payload.now : undefined,
  };
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
  label = key,
): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', `${label} is required.`);
  }
  return value.trim();
}

/**
 * Module-level admin gate on top of capability matrix.
 * Ops-console is platform-admin only even when capability maps to platform.manage.
 */
function requireAdminActor(context: P1Context) {
  if (context.actor !== 'admin') {
    throw new P1DomainError(
      'FORBIDDEN',
      'ops-console requires a trusted admin actor.',
    );
  }
}

export class OpsConsoleFoundationModule implements P1OperationModule {
  readonly name = 'ops-console';

  constructor(private readonly service: OpsConsoleService) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    requireAdminActor(args.context);
    const action = actionOf(args.input);
    const payload = payloadOf(args.input);
    const meta = writeMetaOf(payload);

    if (action === 'publish_release') {
      const input = payload as unknown as PublishHarnessReleaseInput;
      return this.service.publishRelease(args.context, input, meta);
    }

    if (action === 'run_release_eval') {
      const trace = payload.trace;
      if (
        !trace ||
        typeof trace !== 'object' ||
        !Array.isArray((trace as Record<string, unknown>).toolCalls)
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'run_release_eval requires a QuickCheckTrace with toolCalls.',
        );
      }
      return this.service.runReleaseEval(
        args.context,
        {
          releaseId: stringField(payload, 'releaseId'),
          trace: trace as QuickCheckTrace,
        },
        meta,
      );
    }

    if (action === 'transition_lifecycle') {
      return this.service.transitionLifecycle(
        args.context,
        {
          releaseId: stringField(payload, 'releaseId'),
          toStatus: stringField(payload, 'toStatus') as never,
        },
        meta,
      );
    }

    if (action === 'set_canary_allowlist') {
      const allowlist = payload.workspaceAllowlist;
      if (!Array.isArray(allowlist)) {
        throw new P1DomainError(
          'INVALID_STATE',
          'workspaceAllowlist must be an array.',
        );
      }
      return this.service.setCanaryAllowlist(
        args.context,
        {
          releaseId: stringField(payload, 'releaseId'),
          workspaceAllowlist: allowlist.map(String),
        },
        meta,
      );
    }

    if (action === 'set_candidate_trial') {
      return this.service.setCandidateTrial(
        args.context,
        {
          workspaceId: stringField(payload, 'workspaceId'),
          candidateReleaseId: stringField(payload, 'candidateReleaseId'),
        },
        meta,
      );
    }

    if (action === 'promote_to_production') {
      return this.service.promoteToProduction(
        args.context,
        { releaseId: stringField(payload, 'releaseId') },
        meta,
      );
    }

    if (action === 'rollback_production') {
      return this.service.rollbackProduction(
        args.context,
        { toReleaseId: stringField(payload, 'toReleaseId') },
        meta,
      );
    }

    if (action === 'authorize_production_history') {
      return this.service.authorizeProductionHistoryMigration(
        args.context,
        {
          releaseId: stringField(payload, 'releaseId'),
          promotedAt:
            typeof payload.promotedAt === 'string'
              ? payload.promotedAt
              : undefined,
        },
        meta,
      );
    }

    if (action === 'record_rollback_drill') {
      const result = payload.result;
      if (result !== 'passed' && result !== 'failed') {
        throw new P1DomainError(
          'INVALID_STATE',
          'rollback drill result must be passed|failed.',
        );
      }
      return this.service.recordRollbackDrill(
        args.context,
        {
          releaseId: stringField(payload, 'releaseId'),
          result,
          notes:
            typeof payload.notes === 'string' ? payload.notes : null,
        },
        meta,
      );
    }

    if (action === 'create_tool_policy_revision') {
      return this.service.createToolPolicyRevision(
        args.context,
        payload as unknown as Omit<
          AgentToolPolicyRevision,
          'schemaVersion' | 'createdAt' | 'createdBy'
        >,
        meta,
      );
    }

    if (action === 'update_tool_policy') {
      // Constructive block — no in-place path.
      return this.service.updateToolPolicyInPlace();
    }

    if (action === 'set_kill_switch') {
      return this.service.setKillSwitch(
        args.context,
        {
          switchId: stringField(payload, 'switchId'),
          enabled: payload.enabled === true,
        },
        meta,
      );
    }

    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown ops-console action ${action}.`,
    );
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    requireAdminActor(args.context);
    const action = actionOf(args.input);
    const payload = payloadOf(args.input);

    if (action === 'list_releases') {
      return this.service.listReleases();
    }

    if (action === 'get_release') {
      return this.service.getRelease(stringField(payload, 'releaseId'));
    }

    if (action === 'diff_releases') {
      return this.service.diffReleases(
        stringField(payload, 'leftReleaseId'),
        stringField(payload, 'rightReleaseId'),
      );
    }

    if (action === 'list_candidate_trials') {
      return { items: await this.service.listCandidateTrials() };
    }

    if (action === 'list_recent_run_pins') {
      return { items: await this.service.listRecentRunPins() };
    }

    if (action === 'list_rollback_drills') {
      return { items: await this.service.listRollbackDrills() };
    }

    if (action === 'list_tool_policies') {
      return this.service.listToolPolicies();
    }

    if (action === 'get_tool_policy') {
      return this.service.getToolPolicy(
        stringField(payload, 'toolName'),
        stringField(payload, 'revision'),
      );
    }

    if (action === 'list_kill_switches') {
      return { items: await this.service.listKillSwitches() };
    }

    if (action === 'list_audit') {
      const limit =
        typeof payload.limit === 'number' && payload.limit > 0
          ? Math.min(payload.limit, 500)
          : 100;
      return { items: await this.service.listAudit(limit) };
    }

    if (action === 'langfuse_release_url') {
      const releaseId = stringField(payload, 'releaseId');
      return {
        releaseId,
        url: this.service.buildLangfuseReleaseUrl(releaseId),
      };
    }

    // V31-26a / U14: legacy replay archive condition gate (read-only, fail closed).
    if (action === 'legacy_replay_archive_gate') {
      return this.service.legacyReplayArchiveGate({
        now: typeof payload.now === 'string' ? payload.now : undefined,
      });
    }

    // V31-26a: audit export for archive evidence (read-only).
    if (action === 'export_legacy_replay_audit') {
      return this.service.exportLegacyReplayAudit({
        limit: typeof payload.limit === 'number' ? payload.limit : undefined,
        now: typeof payload.now === 'string' ? payload.now : undefined,
      });
    }

    // V31-26a: feature flag / kill switch inventory with flip paths.
    if (action === 'list_v31_feature_flags') {
      return this.service.listV31FeatureFlags();
    }

    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown ops-console query ${action}.`,
    );
  }
}
