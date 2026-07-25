import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { PostgresContextSourceRevisionRepository } from "./context-source-revisions.js";
import { PostgresMarketingIdentityRepository } from "./marketing-identity.js";

const connectionString = process.env.TEST_DATABASE_URL;

test(
	"Postgres keeps default and session identity decisions separate without seeding neutral entities",
	{ skip: !connectionString },
	async () => {
		const pool = new Pool({ connectionString, max: 2 });
		const workspaceId = `identity-workspace-${randomUUID()}`;
		const actorId = `identity-actor-${randomUUID()}`;
		const repository = new PostgresMarketingIdentityRepository(pool);
		try {
			await new PostgresContextSourceRevisionRepository(pool).migrate();
			await repository.migrate();
			await repository.register({
				workspaceId,
				actorId,
				occurredAt: "2026-07-18T01:00:00.000Z",
				command: registration("identity-brand"),
			});
			await repository.register({
				workspaceId,
				actorId,
				occurredAt: "2026-07-18T01:01:00.000Z",
				command: registration("identity-person"),
			});
			await repository.setDefault({
				workspaceId,
				actorId,
				occurredAt: "2026-07-18T01:02:00.000Z",
				decisionId: "default-brand",
				command: {
					expectedDecisionRevision: 0,
					identity: { identityId: "identity-brand", version: 1 },
					reason: "Remember the brand voice.",
				},
			});
			await repository.selectForSession({
				workspaceId,
				actorId,
				occurredAt: "2026-07-18T01:03:00.000Z",
				decisionId: "session-person",
				command: {
					identity: { identityId: "identity-person", version: 1 },
					reason: "Use the owner voice for this session.",
					sessionId: "composer-session-1",
				},
			});

			const projection = await repository.project(
				workspaceId,
				actorId,
				"2026-07-18T02:00:00.000Z",
			);
			assert.deepEqual(projection.defaultIdentity, {
				identityId: "identity-brand",
				version: 1,
			});
			assert.equal(projection.decisionRevision, 2);
			assert.deepEqual(projection.defaultDecision, {
				decisionId: "default-brand",
				decisionRevision: 1,
				identity: { identityId: "identity-brand", version: 1 },
			});
			assert.deepEqual(
				(await repository.listDecisions(workspaceId, actorId)).map(
					(event) => event.action,
				),
				[
					"set_default_marketing_identity",
					"select_marketing_identity_for_session",
				],
			);
			const neutralRows = await pool.query<{ count: string }>(
				`SELECT COUNT(*)::text AS count
           FROM p1_marketing_identity_versions
          WHERE workspace_id = $1
            AND (identity_id = 'official-neutral' OR payload::text ILIKE '%neutral%')`,
				[workspaceId],
			);
			assert.equal(neutralRows.rows[0]?.count, "0");
		} finally {
			await pool.query(
				"DELETE FROM p1_marketing_identity_default_heads WHERE workspace_id = $1",
				[workspaceId],
			);
			await pool.query(
				"DELETE FROM p1_marketing_identity_decisions WHERE workspace_id = $1",
				[workspaceId],
			);
			await pool.query(
				"DELETE FROM p1_marketing_identity_versions WHERE workspace_id = $1",
				[workspaceId],
			);
			await pool.query(
				"DELETE FROM p1_context_source_revisions WHERE workspace_id = $1",
				[workspaceId],
			);
			await pool.end();
		}
	},
);

function registration(identityId: string) {
	return {
		identityId,
		kind: "brand" as const,
		expectedVersion: 0 as const,
		displayName: identityId,
		owner: "青禾门店",
		professionalBoundaries: ["不作医疗承诺"],
		allowedPlatforms: ["xiaohongshu" as const],
		allowedScenes: ["routine_marketing_materials" as const],
		expressionSamples: ["以门店官方口吻介绍服务。"],
		effectiveFrom: "2026-07-18T00:00:00.000Z",
		expiresAt: null,
		departureHandling: "停用后不再生成。",
		sourceRef: `${identityId}-authorization`,
		brandClaims: ["专业护理"],
		forbiddenClaims: [],
		visualPrinciples: [],
		seriesAnchors: [],
	};
}
