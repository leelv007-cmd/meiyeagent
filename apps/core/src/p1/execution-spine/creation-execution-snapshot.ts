import {
	beautyVoiceRoleSchema,
	composerContentPackagePlatformSchema,
	composerDistributionTargetSchema,
	composerSubmissionDeliverableSchema,
	composerSubmissionSignedFieldsBaseSchema,
	creationModeSchema,
	creativeOperationSchema,
	creativeContentModuleIds,
	MAX_NOTE_PLAN_PAGE_COUNT,
	MIN_NOTE_PLAN_PAGE_COUNT,
	resolveComposerGenerationParams,
	thinkingLevelSchema,
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
const creationLensSchema = z.enum([
	"copy",
	"image",
	"image_text_note",
	"video",
]);

const revisionReferenceSchema = z
	.object({
		id: identifierSchema,
		revision: revisionSchema,
	})
	.strict();

const identityDecisionReferenceSchema = z
	.object({
		id: identifierSchema,
		revision: z.number().int().positive(),
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
		kind: z.enum(["copy", "image", "image_text_note", "video"]),
		quantity: z.number().int().positive().max(100),
		order: z.number().int().nonnegative().max(100),
		aspectRatio: z.enum(["1:1", "3:4", "9:16"]).optional(),
		durationSeconds: z.number().int().positive().max(3_600).optional(),
		notePageBound: z
			.number()
			.int()
			.min(MIN_NOTE_PLAN_PAGE_COUNT)
			.max(MAX_NOTE_PLAN_PAGE_COUNT)
			.optional(),
	})
	.strict();

const modelPolicySchema = z
	.object({
		id: identifierSchema,
		revision: revisionSchema,
		mode: z.enum(["auto", "fixed"]),
	})
	.strict();

export const modelSelectionSourceSchema = z.enum([
	"current_selection",
	"user_default",
	"workspace_default",
	"platform_default",
]);

export const frozenModelSelectionSchema = z
	.object({
		source: modelSelectionSourceSchema,
		catalogModelId: identifierSchema,
		platformConfigRevision: revisionSchema.nullable(),
	})
	.strict()
	.superRefine((selection, context) => {
		if (
			selection.source === "platform_default" &&
			selection.platformConfigRevision === null
		) {
			context.addIssue({
				code: "custom",
				message:
					"A platform-default selection requires its platform config revision.",
			});
		}
		if (
			selection.source !== "platform_default" &&
			selection.platformConfigRevision !== null
		) {
			context.addIssue({
				code: "custom",
				message:
					"Only a platform-default selection may carry a platform config revision.",
			});
		}
	});

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
const persistedSignedSubmissionSchema =
	composerSubmissionSignedFieldsBaseSchema.partial({
		creationMode: true,
		intent: true,
	});

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
		creationMode: creationModeSchema,
		intent: z.string().trim().min(1).max(4_000),
		surface: revisionReferenceSchema,
		recipe: revisionReferenceSchema,
		lens: creationLensSchema,
		operation: creativeOperationSchema.optional(),
		platform: z.object({ id: platformSchema }).strict(),
		signedSubmission: persistedSignedSubmissionSchema.optional(),
		deliverables: z.array(deliverableSchema).min(1).max(20),
		sources: sourceReferencesSchema,
		rights: rightsSummarySchema,
		identity: revisionReferenceSchema,
		identityDecision: identityDecisionReferenceSchema.optional(),
		/** P2-09: beauty persona override (MarketingIdentity remains default). */
		beautyVoiceRole: beautyVoiceRoleSchema.optional(),
		/** P2-09: free-mode thinking level mapped to model tiers. */
		thinkingLevel: thinkingLevelSchema.optional(),
		modelPolicy: modelPolicySchema,
		catalogModel: revisionReferenceSchema,
		modelSelection: frozenModelSelectionSchema.optional(),
		quote: revisionReferenceSchema,
		route: revisionReferenceSchema,
		briefContext: briefContextSchema,
		briefConfirmation: revisionReferenceSchema.optional(),
		contentModules: contentModulesSchema,
	})
	// Legacy internal commands may omit signed fields. Composer requests make
	// the same extensible shape required below and freeze it as one object.
	.extend(
		composerSubmissionSignedFieldsBaseSchema
			.omit({ creationMode: true, intent: true })
			.partial().shape,
	)
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
	.omit({
		modelSelection: true,
		operation: true,
		platform: true,
		signedSubmission: true,
	})
	.extend(composerSubmissionSignedFieldsBaseSchema.shape);

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
		creationMode: creationModeSchema,
		intent: z.object({ text: z.string().trim().min(1).max(4_000) }).strict(),
		surface: revisionReferenceSchema,
		recipe: revisionReferenceSchema,
		lens: creationLensSchema,
		operation: creativeOperationSchema,
		platform: z.object({ id: platformSchema }).strict(),
		contentPackagePlatform: composerContentPackagePlatformSchema,
		distributionTarget: composerDistributionTargetSchema,
		deliverable: composerSubmissionDeliverableSchema,
		signedSubmission: persistedSignedSubmissionSchema.optional(),
		deliverables: z.array(deliverableSchema).min(1).max(20),
		sources: sourceReferencesSchema,
		rights: rightsSummarySchema,
		identity: revisionReferenceSchema,
		identityDecision: identityDecisionReferenceSchema.optional(),
		/** P2-09 optional so historical snapshots remain readable. */
		beautyVoiceRole: beautyVoiceRoleSchema.optional(),
		thinkingLevel: thinkingLevelSchema.optional(),
		modelPolicy: modelPolicySchema,
		catalogModel: revisionReferenceSchema,
		/**
		 * Optional only so historical v1 snapshots remain readable. Every new
		 * snapshot created below receives this server-owned fact.
		 */
		modelSelection: frozenModelSelectionSchema.optional(),
		quote: revisionReferenceSchema,
		route: revisionReferenceSchema,
		briefContext: briefContextSchema,
		briefConfirmation: revisionReferenceSchema.optional(),
		contentModules: contentModulesSchema,
		semanticDecision: z
			.object({
				sourceSnapshotId: identifierSchema,
				reference: z
					.object({
						id: identifierSchema,
						field: identifierSchema,
						value: z.string().trim().min(1).max(4_000),
						revision: z.number().int().nonnegative(),
					})
					.strict(),
			})
			.strict()
			.optional(),
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
			creationMode: command.creationMode,
			intent: { text: command.intent },
			surface: command.surface,
			recipe: command.recipe,
			lens: command.lens,
			operation: command.operation ?? operationForLens(command.lens),
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
			identityDecision: command.identityDecision,
			...normalizedGenerationParams(command),
			modelPolicy: command.modelPolicy,
			catalogModel: command.catalogModel,
			modelSelection:
				command.modelSelection ?? {
					source: "current_selection",
					catalogModelId: command.catalogModel.id,
					platformConfigRevision: null,
				},
			quote: command.quote,
			route: command.route,
			briefContext: command.briefContext,
			briefConfirmation: command.briefConfirmation,
			contentModules: command.contentModules,
		}),
	);
}

function operationForLens(lens: z.infer<typeof creationLensSchema>) {
	if (lens === "copy") return "copy.generate" as const;
	if (lens === "image" || lens === "image_text_note") {
		return "image.generate" as const;
	}
	return "video.generate" as const;
}

/**
 * P2-09: normalize generation params by C5 rules before freezing the snapshot.
 * Customized injects the owner default and always pins standard thinking;
 * free keeps an unselected beauty role optional (MarketingIdentity default).
 */
export function normalizedGenerationParams(command: {
	creationMode: "customized" | "free";
	beautyVoiceRole?: z.infer<typeof beautyVoiceRoleSchema>;
	thinkingLevel?: z.infer<typeof thinkingLevelSchema>;
}): {
	beautyVoiceRole?: z.infer<typeof beautyVoiceRoleSchema>;
	thinkingLevel: z.infer<typeof thinkingLevelSchema>;
} {
	return resolveComposerGenerationParams({
		creationMode: command.creationMode,
		beautyVoiceRole: command.beautyVoiceRole,
		thinkingLevel: command.thinkingLevel,
	});
}

function validateSubmission(
	command: {
		catalogModel?: { id: string };
		creationMode?: "customized" | "free";
		contentModules?: string[];
		deliverable?: {
			kind?: string;
			aspectRatio?: string;
			durationSeconds?: number;
			quantity: number;
		};
		deliverables?: Array<{
			aspectRatio?: string;
			durationSeconds?: number;
			kind: string;
			notePageBound?: number;
			order: number;
			quantity: number;
		}>;
		imageOperation?: string;
		lens?: "copy" | "image" | "image_text_note" | "video";
		modelSelection?: {
			source:
				| "current_selection"
				| "user_default"
				| "workspace_default"
				| "platform_default";
			catalogModelId: string;
			platformConfigRevision: string | null;
		};
	},
	context: z.RefinementCtx,
) {
	if (
		command.modelSelection &&
		command.catalogModel &&
		command.modelSelection.catalogModelId !== command.catalogModel.id
	) {
		context.addIssue({
			code: "custom",
			message: "Frozen model selection must match the selected catalog model.",
		});
	}
	if (command.imageOperation !== undefined) {
		if (command.creationMode !== "free") {
			context.addIssue({
				code: "custom",
				message:
					"Only free image creation may declare an explicit image operation.",
				path: ["imageOperation"],
			});
		}
		if (
			command.deliverable?.kind !== "image_set" &&
			command.deliverable?.kind !== "poster"
		) {
			context.addIssue({
				code: "custom",
				message: "An explicit image operation requires an image deliverable.",
				path: ["imageOperation"],
			});
		}
	}
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
	const notePageBound = command.deliverables[0]?.notePageBound;
	if (command.lens === "image_text_note" && notePageBound === undefined) {
		context.addIssue({
			code: "custom",
			message: "Image-text note delivery requires a frozen page bound.",
			path: ["deliverables", 0, "notePageBound"],
		});
	}
	if (command.lens !== "image_text_note" && notePageBound !== undefined) {
		context.addIssue({
			code: "custom",
			message: "Only image-text note delivery may carry a page bound.",
			path: ["deliverables", 0, "notePageBound"],
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
			notePageBound?: number;
			quantity: number;
		};
		deliverables: Array<{
			aspectRatio?: string;
			durationSeconds?: number;
			notePageBound?: number;
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
				executionDeliverable.durationSeconds ||
			snapshot.deliverable.notePageBound !== executionDeliverable.notePageBound)
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
