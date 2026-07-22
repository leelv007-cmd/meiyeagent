import * as z from "zod";

const identifier = z.string().min(1).max(200);
const cursor = z.string().min(1).max(500);
const operation = z.enum([
	"image.generate",
	"image.edit",
	"text.respond",
	"video.generate",
	"audio.speech",
	"audio.sfx",
]);

export const canvasUnavailableReasonCodeSchema = z.enum([
	"CATALOG_UNAVAILABLE",
	"MODEL_DISABLED",
	"MODEL_NOT_CONFIGURED",
	"OPERATION_UNAVAILABLE",
	"WORKSPACE_NOT_ENTITLED",
]);

export const canvasGenerationLineageSchema = z.strictObject({
	originRef: z.literal("advanced_canvas_project_revision"),
	projectId: identifier,
	revisionId: identifier,
});

/**
 * Reserved fields for the item-based fan-out flow. They are intentionally not
 * accepted by the active v1 endpoint until the shared Core contracts land.
 */
export const canvasGenerationItemBindingSchema = z
	.strictObject({
		checkpointId: identifier.optional(),
		itemId: identifier.optional(),
		nodeId: identifier.optional(),
		projectId: identifier,
		revisionId: identifier,
	})
	.refine(
		(value) => Boolean(value.checkpointId || value.nodeId || value.itemId),
		{
			message: "A generation item requires checkpointId, nodeId, or itemId.",
		},
	);

const contractMetadata = {
	compatibility: "additive-v1" as const,
	owner: "Core model-supply" as const,
	test: "apps/canvas/src/server/backend-port-vnext.test.ts" as const,
};

export const CANVAS_BACKEND_PORT_VNEXT = {
	getCatalog: {
		...contractMetadata,
		action: "getCatalog",
		availability: "reserved",
		errors: ["CATALOG_UNAVAILABLE"] as const,
		idempotency: "none",
		request: z.strictObject({}),
		response: z.strictObject({
			defaultModelIdByOperation: z.partialRecord(operation, identifier),
			unavailableReasonCodeByOperation: z.partialRecord(
				operation,
				canvasUnavailableReasonCodeSchema,
			),
		}),
	},
	getSessionContext: {
		...contractMetadata,
		action: "getSessionContext",
		availability: "reserved",
		errors: ["SESSION_EXPIRED"] as const,
		idempotency: "none",
		request: z.strictObject({}),
		response: z.strictObject({
			workspaceDisplayName: z.string().min(1).max(200),
		}),
	},
	listAdoptionTargets: {
		...contractMetadata,
		action: "listAdoptionTargets",
		availability: "reserved",
		errors: ["CONTENT_PACKAGE_NOT_FOUND"] as const,
		idempotency: "none",
		request: z.strictObject({
			cursor: cursor.optional(),
			query: z.string().max(200).optional(),
		}),
		response: z.strictObject({
			items: z.array(
				z.strictObject({ id: identifier, title: z.string().min(1) }),
			),
			nextCursor: cursor.nullable(),
		}),
	},
	listAssets: {
		...contractMetadata,
		action: "listAssets",
		availability: "reserved",
		errors: ["ASSET_NOT_FOUND"] as const,
		idempotency: "none",
		request: z.strictObject({
			cursor: cursor.optional(),
			kind: z.enum(["audio", "image", "video"]).optional(),
			query: z.string().max(200).optional(),
		}),
		response: z.strictObject({
			items: z.array(
				z.strictObject({
					id: identifier,
					kind: z.enum(["audio", "image", "video"]),
				}),
			),
			nextCursor: cursor.nullable(),
		}),
	},
	listPrompts: {
		...contractMetadata,
		action: "listPrompts",
		availability: "reserved",
		errors: ["PROMPT_CATALOG_UNAVAILABLE"] as const,
		idempotency: "none",
		request: z.strictObject({
			category: z.string().max(100).optional(),
			cursor: cursor.optional(),
			query: z.string().max(200).optional(),
		}),
		response: z.strictObject({
			items: z.array(
				z.strictObject({
					category: z.string().max(100).optional(),
					id: identifier,
					prompt: z.string().min(1).max(20_000),
					title: z.string().min(1).max(200),
				}),
			),
			nextCursor: cursor.nullable(),
		}),
	},
	quoteGeneration: {
		...contractMetadata,
		action: "quoteGeneration",
		availability: "active-model-id",
		errors: ["INVALID_INPUT", "MODEL_NOT_CONFIGURED"] as const,
		idempotency: "header",
		request: z.strictObject({ modelId: identifier.optional(), operation }),
		response: z.strictObject({ quoteId: identifier }),
	},
	submitGeneration: {
		...contractMetadata,
		action: "submitGeneration",
		availability: "active-model-id",
		errors: ["INVALID_INPUT", "MODEL_NOT_CONFIGURED", "QUOTE_EXPIRED"] as const,
		idempotency: "header",
		request: z.strictObject({ modelId: identifier.optional(), operation }),
		response: z.strictObject({ jobId: identifier }),
	},
	exportCanvas: {
		...contractMetadata,
		action: "exportCanvas",
		availability: "reserved",
		errors: ["EXPORT_NOT_AVAILABLE", "REVISION_NOT_FOUND"] as const,
		idempotency: "header",
		request: z.strictObject({
			format: z.enum(["json", "zip"]),
			projectId: identifier,
			revisionId: identifier,
		}),
		response: z.strictObject({ exportId: identifier }),
	},
} as const;
