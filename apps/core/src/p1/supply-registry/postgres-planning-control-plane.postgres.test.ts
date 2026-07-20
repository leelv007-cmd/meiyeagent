import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import {
  PostgresSupplyPlanningControlPlane,
  PostgresSupplyPlanningMigration,
} from './postgres-planning-control-plane.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  'Postgres supply planning control plane',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const workspaceId = `planning-${randomUUID()}`;
    const first = new PostgresSupplyPlanningControlPlane(pool, workspaceId);

    before(async () => {
      const client = await pool.connect();
      try {
        await new PostgresSupplyPlanningMigration().migrate(client);
      } finally {
        client.release();
      }
    });

    after(async () => {
      await pool.query(
        'DELETE FROM p1_supply_route_policy_publications WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_route_policy_heads WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_route_policy_revisions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_data_policy_heads WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_ranking_input_heads WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_health_overlay_events WHERE scope_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_health_overlays WHERE scope_id = $1',
        [workspaceId],
      );
      await pool.end();
    });

    it('reloads route, data, ranking and health state after process restart', async () => {
      await first.publishRoutePolicy(
        workspaceId,
        {
          id: 'route-policy-r1',
          operation: 'copy.generate',
          qualityTier: 'quality',
          hardConstraints: ['deployment_active'],
          candidateDeploymentIds: ['deployment-a'],
          maxAttempts: 1,
          fallbackAuthorized: false,
          revisionId: 'route-policy-r1',
        },
        null,
      );
      await first.setDataPolicyBinding(workspaceId, {
        deploymentId: 'deployment-a',
        dataPolicyRevisionId: 'data-policy-r1',
        dataPolicy: {
          sourceTrustLevel: 'platform_verified',
          processingRegion: 'domestic',
          allowedDataClasses: ['public'],
        },
      });
      await first.setRankingInput(workspaceId, {
        deploymentId: 'deployment-a',
        quality: {},
        health: { capacityHeadroom: 0.8 },
        cost: {
          source: 'invoice',
          amountMicros: 100,
          currency: 'CNY',
        },
      });
      await first.health.reportFact({
        targetKind: 'deployment',
        targetId: 'deployment-a',
        kind: 'manual_unavailable',
        reason: 'operator confirmed upstream outage',
        source: 'admin_supply',
      });

      const restarted = new PostgresSupplyPlanningControlPlane(
        pool,
        workspaceId,
      );
      const state = await restarted.readPlanningState({
        workspaceId,
        catalogRevisionId: 'catalog-r1',
        operation: 'copy.generate',
        qualityTier: 'quality' as const,
        deploymentIds: ['deployment-a'],
      });
      assert.equal(state.routePolicyRevisionId, 'route-policy-r1');
      assert.equal(state.routePolicy?.fallbackAuthorized, false);
      assert.equal(
        state.dataPolicyByDeploymentId?.get('deployment-a')
          ?.dataPolicyRevisionId,
        'data-policy-r1',
      );
      assert.equal(
        state.rankingInputsByDeploymentId?.get('deployment-a')?.cost.source,
        'invoice',
      );
      assert.equal(
        (await state.healthOverlay?.get('deployment', 'deployment-a'))?.state,
        'unavailable',
      );
      assert.equal((await restarted.listPublishedRoutePolicies(workspaceId)).length, 1);
    });

    it('rejects a different payload for an existing immutable route revision id', async () => {
      const revisionId = `route-policy-immutable-${randomUUID()}`;
      const revision = {
        id: revisionId,
        operation: 'image.generate' as const,
        qualityTier: 'quality' as const,
        hardConstraints: ['deployment_active'],
        candidateDeploymentIds: ['deployment-image-a'],
        maxAttempts: 1,
        fallbackAuthorized: false,
        revisionId,
      };
      await first.publishRoutePolicy(workspaceId, revision, null);

      await assert.rejects(
        first.publishRoutePolicy(
          workspaceId,
          {
            ...revision,
            candidateDeploymentIds: ['deployment-image-b'],
          },
          revisionId,
        ),
        /immutable route revision id is already bound to another payload/i,
      );
      assert.deepEqual(
        await first.getRoutePolicyRevision(workspaceId, revisionId),
        revision,
      );
    });

    it('persists candidate revisions independently and can publish or roll back a non-head revision', async () => {
      const suffix = randomUUID();
      const firstRevision = {
        id: `route-policy-candidate-r1-${suffix}`,
        operation: 'video.generate' as const,
        qualityTier: 'balanced' as const,
        hardConstraints: ['deployment_active'],
        candidateDeploymentIds: ['deployment-video-a'],
        maxAttempts: 1,
        fallbackAuthorized: false,
        revisionId: `route-policy-candidate-r1-${suffix}`,
      };
      const secondRevision = {
        ...firstRevision,
        id: `route-policy-candidate-r2-${suffix}`,
        candidateDeploymentIds: ['deployment-video-b'],
        revisionId: `route-policy-candidate-r2-${suffix}`,
      };

      await first.saveRoutePolicyCandidate(workspaceId, firstRevision);
      await first.saveRoutePolicyCandidate(workspaceId, secondRevision);

      assert.deepEqual(
        (await first.listRoutePolicyRevisions(workspaceId))
          .filter((revision) => revision.revisionId.endsWith(suffix))
          .map((revision) => revision.revisionId),
        [firstRevision.revisionId, secondRevision.revisionId],
      );
      assert.equal(
        (await first.listPublishedRoutePolicies(workspaceId)).some(
          (revision) => revision.revisionId.endsWith(suffix),
        ),
        false,
      );

      await first.publishRoutePolicy(workspaceId, firstRevision, null);
      await assert.rejects(
        first.rollbackRoutePolicy({
          workspaceId,
          operation: firstRevision.operation,
          qualityTier: firstRevision.qualityTier,
          expectedHeadRevisionId: firstRevision.revisionId,
          targetRevisionId: secondRevision.revisionId,
        }),
        /previously published|rollback target/i,
      );
      await first.publishRoutePolicy(
        workspaceId,
        secondRevision,
        firstRevision.revisionId,
      );
      assert.equal(
        (await first.listPublishedRoutePolicies(workspaceId)).find(
          (revision) =>
            revision.operation === firstRevision.operation &&
            revision.qualityTier === firstRevision.qualityTier,
        )?.revisionId,
        secondRevision.revisionId,
      );
      assert.deepEqual(
        (await first.listRoutePolicyPublicationHistory(workspaceId))
          .filter((revision) => revision.revisionId.endsWith(suffix))
          .map((revision) => revision.revisionId),
        [firstRevision.revisionId, secondRevision.revisionId],
      );

      await first.rollbackRoutePolicy({
        workspaceId,
        operation: firstRevision.operation,
        qualityTier: firstRevision.qualityTier,
        expectedHeadRevisionId: secondRevision.revisionId,
        targetRevisionId: firstRevision.revisionId,
      });
      assert.equal(
        (await first.listPublishedRoutePolicies(workspaceId)).find(
          (revision) =>
            revision.operation === firstRevision.operation &&
            revision.qualityTier === firstRevision.qualityTier,
        )?.revisionId,
        firstRevision.revisionId,
      );
    });

    it('reads the requested candidate revision for validation without changing the published head', async () => {
      const suffix = randomUUID();
      const head = {
        id: `route-policy-validation-head-${suffix}`,
        operation: 'audio.speech' as const,
        qualityTier: 'quality' as const,
        hardConstraints: ['deployment_active'],
        candidateDeploymentIds: ['deployment-audio-head'],
        maxAttempts: 1,
        fallbackAuthorized: false,
        revisionId: `route-policy-validation-head-${suffix}`,
      };
      const candidate = {
        ...head,
        id: `route-policy-validation-candidate-${suffix}`,
        candidateDeploymentIds: ['deployment-audio-candidate'],
        revisionId: `route-policy-validation-candidate-${suffix}`,
      };
      await first.saveRoutePolicyCandidate(workspaceId, head);
      await first.saveRoutePolicyCandidate(workspaceId, candidate);
      await first.publishRoutePolicy(workspaceId, head, null);

      const state = await first.readPlanningState({
        workspaceId,
        catalogRevisionId: 'catalog-r1',
        operation: 'audio.speech',
        qualityTier: 'quality',
        deploymentIds: ['deployment-audio-head', 'deployment-audio-candidate'],
        routePolicyRevisionId: candidate.revisionId,
      });

      assert.equal(state.routePolicyRevisionId, candidate.revisionId);
      assert.deepEqual(state.routePolicy?.candidateDeploymentIds, [
        'deployment-audio-candidate',
      ]);
      assert.equal(
        (await first.listPublishedRoutePolicies(workspaceId)).find(
          (revision) => revision.operation === 'audio.speech',
        )?.revisionId,
        head.revisionId,
      );
    });

    it('serializes concurrent first health facts without losing counters', async () => {
      const targetId = `deployment-concurrent-${randomUUID()}`;
      const functionName = `p1_test_delay_health_${randomUUID().replaceAll('-', '_')}`;
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.scope_id = '${workspaceId}' AND NEW.target_id = '${targetId}' THEN
            PERFORM pg_sleep(0.15);
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${functionName}
          BEFORE INSERT ON p1_supply_health_overlays
          FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);
      try {
        await Promise.all([
          first.health.reportFact({
            targetKind: 'deployment',
            targetId,
            kind: 'server_error',
            reason: 'concurrent failure one',
            source: 'postgres_concurrency_test',
          }),
          first.health.reportFact({
            targetKind: 'deployment',
            targetId,
            kind: 'server_error',
            reason: 'concurrent failure two',
            source: 'postgres_concurrency_test',
          }),
        ]);

        const stored = await pool.query<{
          value: {
            counters: { consecutiveFails: number; consecutive5xx: number };
          };
        }>(
          `SELECT value FROM p1_supply_health_overlays
            WHERE scope_id = $1 AND target_id = $2`,
          [workspaceId, targetId],
        );
        assert.deepEqual(stored.rows[0]?.value.counters, {
          consecutiveFails: 2,
          consecutive5xx: 2,
        });
        const events = await pool.query<{
          resulting_value: {
            counters: { consecutiveFails: number; consecutive5xx: number };
          };
        }>(
          `SELECT resulting_value
             FROM p1_supply_health_overlay_events
            WHERE scope_id = $1 AND target_key = $2
            ORDER BY id`,
          [workspaceId, `deployment:${targetId}`],
        );
        assert.deepEqual(
          events.rows.map(({ resulting_value }) => resulting_value.counters),
          [
            { consecutiveFails: 1, consecutive5xx: 1 },
            { consecutiveFails: 2, consecutive5xx: 2 },
          ],
        );
      } finally {
        await pool.query(`DROP TRIGGER ${functionName} ON p1_supply_health_overlays`);
        await pool.query(`DROP FUNCTION ${functionName}()`);
      }
    });
  },
);
