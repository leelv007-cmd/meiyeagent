import type { CreativeOperation, SupplyOperation } from "@meiye/contracts";

import { P1DomainError, type RouteSnapshot } from "../foundation/domain.js";
import type { FoundationRepository } from "../foundation/ports.js";
import type { RouteSnapshot as ModelSupplyRouteSnapshot } from "../model-supply/index.js";
import type { DataClass } from "../model-supply/supply-contracts.js";
import {
	fromModelSupplyRouteSnapshot,
	toFoundationRouteCheckpoint,
} from "../route-snapshot-normalize.js";
import { nativeSupplyOperation } from "../harness/image-intent-compiler.js";

export interface ComposerRouteResolverPort {
	resolve(input: {
		catalogModel: { id: string; revision: string };
		dataClass: DataClass[];
		operation: CreativeOperation;
		routeSnapshotId?: string;
		workspaceId: string;
	}): Promise<RouteSnapshot | null>;
}

interface FixedRouteFreezer {
	freezeFixedRouteForExecution(input: {
		catalogModelId: string;
		dataClass: DataClass[];
		operation: SupplyOperation;
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
		dataClass: DataClass[];
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
			dataClass: normalizeDataClass(input.dataClass),
			operation: nativeSupplyOperation(input.operation),
			workspaceId: input.workspaceId,
		});
		if (
			frozen.catalogRevisionId !== input.catalogModel.revision ||
			frozen.actualCatalogModelId !== input.catalogModel.id ||
			frozen.requestedSelection.mode !== "fixed" ||
			JSON.stringify(normalizeDataClass(frozen.dataClass)) !==
				JSON.stringify(normalizeDataClass(input.dataClass))
		) {
			throw new P1DomainError(
				"INVALID_STATE",
				"The current model route no longer matches the confirmed ProductQuote.",
			);
		}

		const dataClasses = normalizeDataClass(input.dataClass);
		const route: RouteSnapshot = {
			...toFoundationRouteCheckpoint(fromModelSupplyRouteSnapshot(frozen), {
				catalogRevision: input.catalogModel.revision,
				dataClass: dataClasses[0] ?? "public",
				dataClasses: dataClasses.length > 0 ? dataClasses : ["public"],
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

function normalizeDataClass(dataClass: DataClass[]) {
	return [...new Set(dataClass)].sort();
}
