import {
	composerContentPackagePlatformSchema,
	composerDistributionTargetSchema,
	composerSubmissionDeliverableSchema,
	composerSubmissionSignedFieldsSchema,
	creativeContentModuleIds,
} from "@meiye/contracts";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const revisionSchema = z.string().trim().min(1).max(200);
const platformSchema = z.enum([
	"xiaohongshu",
	"douyin",
	"video_account",
	"wechat_moments",
	"offline",
]);
const creationLensSchema = z.enum(["copy", "image", "video"]);

const revisionReferenceSchema = z
	.object({
		id: identifierSchema,
		revision: revisionSchema,
	})
	.strict();

export const OFFICIAL_NEUTRAL_IDENTITY = {
	id: "official-neutral",
	revision: "1",
} as const;

export function isOfficialNeutralIdentity(
	identity: { id: string; revision: string },
) {
	return (
		identity.id === OFFICIAL_NEUTRAL_IDENTITY.id &&
		identity.revision === OFFICIAL_NEUTRAL_IDENTITY.revision
	);
}

const assetReferenceSchema = revisionReferenceSchema
	.extend({
		role: z.enum(["reference", "source", "style", "subject"]),
	})
	.strict();

const sourceReferencesSchema = z
	.object({
		assets: z.array(assetReferenceSchema).max(50),
		contentPackage: revisionReferenceSchema.optional(),
	})
	.strict();

const deliverableSchema = z
	.object({
		id: identifierSchema,
		kind: z.enum(["copy", "image", "video"]),
		quantity: z.number().int().positive().max(100),
		order: z.number().int().nonnegative().max(100),
		aspectRatio: z.enum(["1:1", "3:4", "9:16"]).optional(),
		durationSeconds: z.number().int().positive().max(3_600).optional(),
	})
	.strict();

const modelPolicySchema = z
	.object({
		id: identifierSchema,
		revision: revisionSchema,
		mode: z.enum(["auto", "fixed"]),
	})
	.strict();

const rightsSummarySchema = z
	.object({
		revision: revisionSchema,
		summary: z.string().trim().min(1).max(2_000),
	})
	.strict();

const briefContextSchema = z
	.object({
		id: identifierSchema,
		revision: z.number().int().nonnegative(),
	})
	.strict();

const contentModulesSchema = z
	.array(z.enum(creativeContentModuleIds))
	.min(1)
	.max(creativeContentModuleIds.length);

export const CREATION_EXECUTION_SNAPSHOT_SCHEMA_VERSION =
	"creation-execution-snapshot/v1" as const;

/**
 * Server-owned Composer submission input. It intentionally carries only ids,
 * revisions and human-readable summaries; binaries and provider responses do
 * not belong in the execution root.
 */
const creationSubmissionCommandBaseSchema = z
	.object({
		actorId: identifierSchema,
		workspaceId: identifierSchema,
		idempotencyKey: identifierSchema,
		taskId: identifierSchema,
		workId: identifierSchema,
		contentPackageId: identifierSchema,
		expectedContentPackageRevision: z.number().int().nonnegative(),
		intent: z.string().trim().min(1).max(4_000),
		surface: revisionReferenceSchema,
		recipe: revisionReferenceSchema,
		lens: creationLensSchema,
		platform: z.object({ id: platformSchema }).strict(),
		signedSubmission: composerSubmissionSignedFieldsSchema.optional(),
		deliverables: z.array(deliverableSchema).min(1).max(20),
		sources: sourceReferencesSchema,
		rights: rightsSummarySchema,
		identity: revisionReferenceSchema,
		modelPolicy: modelPolicySchema,
		catalogModel: revisionReferenceSchema,
		quote: revisionReferenceSchema,
		route: revisionReferenceSchema,
		briefContext: briefContextSchema,
		briefConfirmation: revisionReferenceSchema.optional(),
		contentModules: contentModulesSchema,
	})
	// Legacy internal commands may omit signed fields. Composer requests make
	// the same extensible shape required below and freeze it as one object.
	.extend(composerSubmissionSignedFieldsSchema.partial().shape)
	.extend({
		catalogModel: revisionReferenceSchema,
		recipe: revisionReferenceSchema,
	})
	.strict();

export const creationSubmissionCommandSchema =
	creationSubmissionCommandBaseSchema.superRefine(validateSubmission);

const composerSubmissionRequestBaseSchema = creationSubmissionCommandBaseSchema
	.omit({
		taskId: true,
		workId: true,
		contentPackageId: true,
		expectedContentPackageRevision: true,
	})
	.partial({
		contentModules: true,
		deliverables: true,
		identity: true,
		lens: true,
		modelPolicy: true,
		rights: true,
		route: true,
	})
	.omit({ platform: true, signedSubmission: true })
	.extend(composerSubmissionSignedFieldsSchema.shape);

export const composerSubmissionRequestSchema =
	composerSubmissionRequestBaseSchema.superRefine(validateSubmission);

export const composerSubmissionBodySchema = composerSubmissionRequestBaseSchema
	.omit({ actorId: true, workspaceId: true })
	.superRefine(validateSubmission);

export type CreationSubmissionCommand = z.infer<
	typeof creationSubmissionCommandSchema
>;
export type ComposerSubmissionRequest = z.infer<
	typeof composerSubmissionRequestSchema
>;
export type ComposerSubmissionBody = z.infer<
	typeof composerSubmissionBodySchema
>;

export const creationExecutionSnapshotSchema = z
	.object({
		id: identifierSchema,
		schemaVersion: z.literal(CREATION_EXECUTION_SNAPSHOT_SCHEMA_VERSION),
		revision: z.literal(1),
		createdAt: z.iso.datetime(),
		actorId: identifierSchema,
		workspaceId: identifierSchema,
		task: z.object({ id: identifierSchema }).strict(),
		work: z.object({ id: identifierSchema }).strict(),
		contentPackage: z
			.object({
				id: identifierSchema,
				expectedRevision: z.number().int().nonnegative(),
			})
			.strict(),
		intent: z.object({ text: z.string().trim().min(1).max(4_000) }).strict(),
		surface: revisionReferenceSchema,
		recipe: revisionReferenceSchema,
		lens: creationLensSchema,
		platform: z.object({ id: platformSchema }).strict(),
		contentPackagePlatform: composerContentPackagePlatformSchema,
		distributionTarget: composerDistributionTargetSchema,
		deliverable: composerSubmissionDeliverableSchema,
		signedSubmission: composerSubmissionSignedFieldsSchema.optional(),
		deliverables: z.array(deliverableSchema).min(1).max(20),
		sources: sourceReferencesSchema,
		rights: rightsSummarySchema,
		identity: revisionReferenceSchema,
		modelPolicy: modelPolicySchema,
		catalogModel: revisionReferenceSchema,
		quote: revisionReferenceSchema,
		route: revisionReferenceSchema,
		briefContext: briefContextSchema,
		briefConfirmation: revisionReferenceSchema.optional(),
		contentModules: contentModulesSchema,
	})
	.strict()
	.superRefine(validateFrozenDeliverable);

export type CreationExecutionSnapshot = z.infer<
	typeof creationExecutionSnapshotSchema
>;

export function createCreationExecutionSnapshot(
	input: CreationSubmissionCommand,
	createdAt: string,
): CreationExecutionSnapshot {
	const command = creationSubmissionCommandSchema.parse(input);
	return deepFreeze(
		creationExecutionSnapshotSchema.parse({
			id: `snapshot-${command.taskId}`,
			schemaVersion: CREATION_EXECUTION_SNAPSHOT_SCHEMA_VERSION,
			revision: 1,
			createdAt,
			actorId: command.actorId,
			workspaceId: command.workspaceId,
			task: { id: command.taskId },
			work: { id: command.workId },
			contentPackage: {
				id: command.contentPackageId,
				expectedRevision: command.expectedContentPackageRevision,
			},
			intent: { text: command.intent },
			surface: command.surface,
			recipe: command.recipe,
			lens: command.lens,
			platform: command.platform,
			contentPackagePlatform:
				command.contentPackagePlatform ??
				(command.platform.id === "offline"
					? "offline_material"
					: command.platform.id),
			distributionTarget:
				command.distributionTarget ??
				(command.platform.id === "wechat_moments"
					? "assisted_handoff"
					: "export"),
			deliverable:
				command.deliverable ??
				legacySignedDeliverable(command.deliverables[0]),
			signedSubmission: command.signedSubmission,
			deliverables: command.deliverables,
			sources: command.sources,
			rights: command.rights,
			identity: command.identity,
			modelPolicy: command.modelPolicy,
			catalogModel: command.catalogModel,
			quote: command.quote,
			route: command.route,
			briefContext: command.briefContext,
			briefConfirmation: command.briefConfirmation,
			contentModules: command.contentModules,
		}),
	);
}

function validateSubmission(
	command: {
		contentModules?: string[];
		deliverable?: {
			aspectRatio?: string;
			durationSeconds?: number;
			quantity: number;
		};
		deliverables?: Array<{
			aspectRatio?: string;
			durationSeconds?: number;
			kind: string;
			order: number;
			quantity: number;
		}>;
		lens?: "copy" | "image" | "video";
	},
	context: z.RefinementCtx,
) {
	if (!command.contentModules || !command.deliverables || !command.lens) return;
	const orders = command.deliverables.map((deliverable) => deliverable.order);
	if (new Set(orders).size !== orders.length) {
		context.addIssue({
			code: "custom",
			message: "Deliverable order values must be unique.",
			path: ["deliverables"],
		});
	}
	if (command.deliverables.length !== 1) {
		context.addIssue({
			code: "custom",
			message: "A Composer submission must contain exactly one modality deliverable.",
			path: ["deliverables"],
		});
	}
	if (command.deliverables.some((deliverable) => deliverable.kind !== command.lens)) {
		context.addIssue({
			code: "custom",
			message: "Deliverable kind must match the selected Composer modality.",
			path: ["deliverables"],
		});
	}
	if (new Set(command.contentModules).size !== command.contentModules.length) {
		context.addIssue({
			code: "custom",
			message: "Content modules must not be duplicated.",
			path: ["contentModules"],
		});
	}
}

function validateFrozenDeliverable(
	snapshot: {
		deliverable: {
			aspectRatio?: string;
			durationSeconds?: number;
			quantity: number;
		};
		deliverables: Array<{
			aspectRatio?: string;
			durationSeconds?: number;
			quantity: number;
		}>;
	},
	context: z.RefinementCtx,
) {
	const executionDeliverable = snapshot.deliverables[0];
	if (
		executionDeliverable &&
		(snapshot.deliverable.quantity !== executionDeliverable.quantity ||
			snapshot.deliverable.aspectRatio !== executionDeliverable.aspectRatio ||
			snapshot.deliverable.durationSeconds !==
				executionDeliverable.durationSeconds)
	) {
		context.addIssue({
			code: "custom",
			message: "Execution deliverable must preserve the user-confirmed settings.",
			path: ["deliverables"],
		});
	}
}

function legacySignedDeliverable(
	deliverable: z.infer<typeof deliverableSchema> | undefined,
): z.infer<typeof composerSubmissionDeliverableSchema> {
	if (!deliverable) {
		throw new Error("Creation command requires one deliverable.");
	}
	return {
		kind:
			deliverable.kind === "copy"
				? "copy_document"
				: deliverable.kind === "video"
					? "video_package"
					: "image_text_package",
		quantity: deliverable.quantity,
		...(deliverable.aspectRatio
			? { aspectRatio: deliverable.aspectRatio }
			: {}),
		...(deliverable.durationSeconds
			? { durationSeconds: deliverable.durationSeconds }
			: {}),
	};
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value as Record<string, unknown>)) {
			deepFreeze(item);
		}
	}
	return value;
}
