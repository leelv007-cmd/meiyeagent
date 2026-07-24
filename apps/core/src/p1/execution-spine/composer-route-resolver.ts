import type { CreativeOperation } from "@meiye/contracts";

import { P1DomainError, type RouteSnapshot } from "../foundation/domain.js";
import type { FoundationRepository } from "../foundation/ports.js";
import type { RouteSnapshot as ModelSupplyRouteSnapshot } from "../model-supply/index.js";
import {
	fromModelSupplyRouteSnapshot,
	toFoundationRouteCheckpoint,
} from "../route-snapshot-normalize.js";

export interface ComposerRouteResolverPort {
	resolve(input: {
		catalogModel: { id: string; revision: string };
		operation: CreativeOperation;
		routeSnapshotId?: string;
		workspaceId: string;
	}): Promise<RouteSnapshot | null>;
}

interface FixedRouteFreezer {
	freezeFixedRouteForExecution(input: {
		catalogModelId: string;
		dataClass: [];
		operation: CreativeOperation;
		workspaceId: string;
	}): Promise<ModelSupplyRouteSnapshot>;
}

/**
 * Freezes the model selected by a confirmed ProductQuote into the Foundation
 * route ledger. Browser submissions never provide provider or deployment facts.
 */
export class ModelSupplyComposerRouteResolver
	implements ComposerRouteResolverPort
{
	constructor(
		private readonly freezer: FixedRouteFreezer,
		private readonly routes: Pick<
			FoundationRepository,
			"getRouteSnapshot" | "insertRouteSnapshot"
		>,
	) {}

	async resolve(input: {
		catalogModel: { id: string; revision: string };
		operation: CreativeOperation;
		routeSnapshotId?: string;
		workspaceId: string;
	}): Promise<RouteSnapshot | null> {
		if (input.routeSnapshotId) {
			return this.routes.getRouteSnapshot(
				input.workspaceId,
				input.routeSnapshotId,
			);
		}

		const frozen = await this.freezer.freezeFixedRouteForExecution({
			catalogModelId: input.catalogModel.id,
			dataClass: [],
			operation: input.operation,
			workspaceId: input.workspaceId,
		});
		if (
			frozen.catalogRevisionId !== input.catalogModel.revision ||
			frozen.actualCatalogModelId !== input.catalogModel.id ||
			frozen.requestedSelection.mode !== "fixed"
		) {
			throw new P1DomainError(
				"INVALID_STATE",
				"The current model route no longer matches the confirmed ProductQuote.",
			);
		}

		const route: RouteSnapshot = {
			...toFoundationRouteCheckpoint(fromModelSupplyRouteSnapshot(frozen), {
				catalogRevision: input.catalogModel.revision,
				dataClass: "public",
				dataClasses: ["public"],
				fallbackConsent: false,
				requestedCatalogModelId: input.catalogModel.id,
				selectionMode: "fixed",
			}),
			createdAt: frozen.createdAt,
			workspaceId: input.workspaceId,
		};
		const existing = await this.routes.getRouteSnapshot(
			input.workspaceId,
			route.id,
		);
		if (existing) return existing;

		try {
			await this.routes.insertRouteSnapshot(route);
			return route;
		} catch (error) {
			const replayed = await this.routes.getRouteSnapshot(
				input.workspaceId,
				route.id,
			);
			if (replayed) return replayed;
			throw error;
		}
	}
}
