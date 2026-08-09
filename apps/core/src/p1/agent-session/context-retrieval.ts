/**
 * Turn-in-loop retrieval tools (V31-07 / V3.1 §20.2–§20.3).
 *
 * Workflow-merged tools (not endpoint-shaped). Wrap existing services via ports.
 * Retrieval responses always include response_format echo + semantic fields.
 * Free creation (D-175): store/project tools return empty without blocking.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

import {
  AgentToolRegistry,
  retrievalArgsBaseSchema,
  type AgentToolPolicy,
  type ResponseFormat,
} from './tool-registry.js';

// ─── Ports (wrap existing services; no re-query logic) ──────────────────────

export type RetrievalProject = {
  ref: string;
  name: string;
  confirmed: boolean;
  summary?: string;
};

export type RetrievalStoreFact = {
  ref: string;
  kind: string;
  key: string;
  value: unknown;
  revision?: number;
  freshness?: string;
};

export type RetrievalAsset = {
  ref: string;
  category?: string;
  description?: string;
  rightsStatus?: string;
  allowedPlatforms?: string[];
  containsPerson?: boolean;
};

export type RetrievalIdentity = {
  ref?: string;
  name?: string;
  status?: string;
  summary?: string;
  isDefault?: boolean;
};

export type RetrievalContent = {
  ref: string;
  summary: string;
  kind?: string;
  updatedAt?: string;
};

export type RetrievalExperience = {
  ref: string;
  instruction: string;
  status: 'confirmed' | 'pending';
  kind?: string;
};

export type SessionRetrievalPorts = {
  listStoreProjects?: (input: {
    workspaceId: string;
    creationMode?: 'customized' | 'free';
  }) => Promise<RetrievalProject[]>;
  listConfirmedStoreFacts?: (input: {
    workspaceId: string;
    storeId?: string;
    query?: string;
    limit?: number;
    creationMode?: 'customized' | 'free';
  }) => Promise<RetrievalStoreFact[]>;
  listAuthorizedAssets?: (input: {
    workspaceId: string;
    query?: string;
    limit?: number;
  }) => Promise<RetrievalAsset[]>;
  readMarketingIdentity?: (input: {
    workspaceId: string;
  }) => Promise<RetrievalIdentity | null>;
  listRecentContent?: (input: {
    workspaceId: string;
    limit?: number;
  }) => Promise<RetrievalContent[]>;
  listConfirmedExperience?: (input: {
    workspaceId: string;
    threadId?: string;
    limit?: number;
  }) => Promise<RetrievalExperience[]>;
  readPlatformRequirements?: (input: {
    platform: string;
  }) => Promise<Record<string, unknown>>;
  readModelCapabilities?: (input: {
    workspaceId: string;
  }) => Promise<{
    available: string[];
    unavailable: string[];
  }>;
};

export type RetrievalToolContext = {
  workspaceId: string;
  threadId?: string;
  creationMode?: 'customized' | 'free';
  storeId?: string;
};

/**
 * V31-18: per-turn memory injection binding. The turn runner (which owns
 * taskId/runId/harnessReleaseId) sets this for the duration of a kernel turn;
 * the `read_confirmed_experience` injection path reads it so the platform can
 * record the MemoryInjectionReceipt at the real injection point.
 */
export type MemoryInjectionTurnBinding = {
  taskId?: string;
  runId: string;
  harnessReleaseId: string;
};

const memoryInjectionTurnContext =
  new AsyncLocalStorage<MemoryInjectionTurnBinding>();

export function runWithMemoryInjectionTurnBinding<T>(
  binding: MemoryInjectionTurnBinding,
  callback: () => T,
): T {
  return memoryInjectionTurnContext.run(binding, callback);
}

export function currentMemoryInjectionTurnBinding():
  | MemoryInjectionTurnBinding
  | undefined {
  return memoryInjectionTurnContext.getStore();
}

const INTENT_PLAN_PHASES = ['intent', 'plan', 'make', 'delivery'] as const;

function basePolicy(
  partial: Omit<AgentToolPolicy, 'allowedPhases' | 'approval' | 'riskClass'> &
    Partial<
      Pick<AgentToolPolicy, 'allowedPhases' | 'approval' | 'riskClass'>
    >,
): AgentToolPolicy {
  return {
    riskClass: 'read',
    approval: 'never',
    allowedPhases: [...INTENT_PLAN_PHASES],
    ...partial,
  };
}

function formatList<T>(
  items: readonly T[],
  format: ResponseFormat,
  conciseLimit: number,
): T[] {
  if (format === 'detailed') return [...items];
  return items.slice(0, conciseLimit);
}

function emptyFreeStoreResponse(format: ResponseFormat) {
  return {
    response_format: format,
    creationMode: 'free' as const,
    items: [] as const,
    note: 'Day-0 free creation: store/project facts waived (D-175); do not invent store claims.',
  };
}

// ─── Per-tool input schemas (pin Zod; replace kernel passthrough) ───────────

export const findStoreProjectsArgsSchema = retrievalArgsBaseSchema;
export const readConfirmedStoreFactsArgsSchema = retrievalArgsBaseSchema.extend(
  {
    storeId: z.string().min(1).max(200).optional(),
  },
);
export const findAuthorizedAssetsArgsSchema = retrievalArgsBaseSchema;
export const readMarketingIdentityArgsSchema = z
  .object({
    response_format: z.enum(['concise', 'detailed']).optional().default('concise'),
  })
  .strict();
export const readRecentContentArgsSchema = retrievalArgsBaseSchema;
export const readConfirmedExperienceArgsSchema = retrievalArgsBaseSchema;
export const readPlatformRequirementsArgsSchema = z
  .object({
    platform: z.string().min(1).max(100),
    response_format: z.enum(['concise', 'detailed']).optional().default('concise'),
  })
  .strict();
export const readModelCapabilitiesArgsSchema = z
  .object({
    response_format: z.enum(['concise', 'detailed']).optional().default('concise'),
  })
  .strict();

export const RETRIEVAL_TOOL_NAMES = [
  'find_store_projects',
  'read_confirmed_store_facts',
  'find_authorized_assets',
  'read_marketing_identity',
  'read_recent_content',
  'read_confirmed_experience',
  'read_platform_requirements',
  'read_model_capabilities',
] as const;

export type RetrievalToolName = (typeof RETRIEVAL_TOOL_NAMES)[number];

/**
 * Build the first-batch read-only retrieval tool registry for session harness.
 */
export function createRetrievalToolRegistry(input: {
  ports: SessionRetrievalPorts;
  /** Bound per-turn context (workspace isolation). */
  context: RetrievalToolContext;
  /** Override defaults for maxCalls / timeout if needed. */
  defaults?: {
    maxCallsPerRun?: number;
    timeoutMs?: number;
  };
}): AgentToolRegistry {
  const maxCalls = input.defaults?.maxCallsPerRun ?? 4;
  const timeoutMs = input.defaults?.timeoutMs ?? 8_000;
  const { ports, context } = input;
  const registry = new AgentToolRegistry();

  registry.register({
    policy: basePolicy({
      toolName: 'find_store_projects',
      description:
        'Find confirmed store projects/services for this workspace. Returns semantic project refs (not DB physical keys). Does not write. Free creation returns empty without blocking.',
      sideEffect: 'none',
      dataClasses: ['store_project'],
      maxCallsPerRun: maxCalls,
      timeoutMs,
      inputSchema: findStoreProjectsArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = findStoreProjectsArgsSchema.parse(raw ?? {});
      const format = args.response_format;
      if (context.creationMode === 'free') {
        return emptyFreeStoreResponse(format);
      }
      const items = ports.listStoreProjects
        ? await ports.listStoreProjects({
            workspaceId: context.workspaceId,
            creationMode: context.creationMode,
          })
        : [];
      return {
        response_format: format,
        items: formatList(items, format, 8),
        truncated: format === 'concise' && items.length > 8,
        hint:
          items.length === 0
            ? 'No confirmed projects; prefer free generic copy or ask one project-scope question.'
            : undefined,
      };
    },
  });

  registry.register({
    policy: basePolicy({
      toolName: 'read_confirmed_store_facts',
      description:
        'Read active confirmed store facts (prices, hours, promotions). Semantic fields only. Free creation returns empty and must not invent facts.',
      sideEffect: 'none',
      dataClasses: ['store_fact'],
      maxCallsPerRun: maxCalls,
      timeoutMs,
      inputSchema: readConfirmedStoreFactsArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = readConfirmedStoreFactsArgsSchema.parse(raw ?? {});
      const format = args.response_format;
      if (context.creationMode === 'free') {
        return emptyFreeStoreResponse(format);
      }
      const items = ports.listConfirmedStoreFacts
        ? await ports.listConfirmedStoreFacts({
            workspaceId: context.workspaceId,
            storeId: args.storeId ?? context.storeId,
            query: args.query,
            limit: args.limit ?? (format === 'detailed' ? 20 : 8),
            creationMode: context.creationMode,
          })
        : [];
      return {
        response_format: format,
        items: formatList(items, format, 8),
        truncated: format === 'concise' && items.length > 8,
      };
    },
  });

  registry.register({
    policy: basePolicy({
      toolName: 'find_authorized_assets',
      description:
        'Find merchant assets that are authorized for marketing use. Returns rights status and semantic descriptions; never returns unauthorized media bytes.',
      sideEffect: 'none',
      dataClasses: ['asset_rights'],
      maxCallsPerRun: maxCalls,
      timeoutMs,
      inputSchema: findAuthorizedAssetsArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = findAuthorizedAssetsArgsSchema.parse(raw ?? {});
      const format = args.response_format;
      const items = ports.listAuthorizedAssets
        ? await ports.listAuthorizedAssets({
            workspaceId: context.workspaceId,
            query: args.query,
            limit: args.limit ?? (format === 'detailed' ? 12 : 6),
          })
        : [];
      return {
        response_format: format,
        items: formatList(items, format, 6),
        truncated: format === 'concise' && items.length > 6,
      };
    },
  });

  registry.register({
    policy: basePolicy({
      toolName: 'read_marketing_identity',
      description:
        'Read the active/default marketing identity for this workspace (voice, persona summary). Read-only.',
      sideEffect: 'none',
      dataClasses: ['marketing_identity'],
      maxCallsPerRun: 2,
      timeoutMs,
      inputSchema: readMarketingIdentityArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = readMarketingIdentityArgsSchema.parse(raw ?? {});
      const identity = ports.readMarketingIdentity
        ? await ports.readMarketingIdentity({
            workspaceId: context.workspaceId,
          })
        : null;
      return {
        response_format: args.response_format,
        identity,
        note: identity
          ? undefined
          : 'No marketing identity registered; use neutral generic voice.',
      };
    },
  });

  registry.register({
    policy: basePolicy({
      toolName: 'read_recent_content',
      description:
        'Read recent content packages/results for style continuity. Summaries only; no full transcript dump.',
      sideEffect: 'none',
      dataClasses: ['content_history'],
      maxCallsPerRun: maxCalls,
      timeoutMs,
      inputSchema: readRecentContentArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = readRecentContentArgsSchema.parse(raw ?? {});
      const format = args.response_format;
      const items = ports.listRecentContent
        ? await ports.listRecentContent({
            workspaceId: context.workspaceId,
            limit: args.limit ?? (format === 'detailed' ? 6 : 3),
          })
        : [];
      return {
        response_format: format,
        items: formatList(items, format, 3),
        truncated: format === 'concise' && items.length > 3,
      };
    },
  });

  registry.register({
    policy: basePolicy({
      toolName: 'read_confirmed_experience',
      description:
        'Read confirmed merchant experience/preferences (Memory projection). Session pending items are labeled pending and must not auto-apply.',
      sideEffect: 'none',
      dataClasses: ['experience_memory'],
      maxCallsPerRun: maxCalls,
      timeoutMs,
      inputSchema: readConfirmedExperienceArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = readConfirmedExperienceArgsSchema.parse(raw ?? {});
      const format = args.response_format;
      const items = ports.listConfirmedExperience
        ? await ports.listConfirmedExperience({
            workspaceId: context.workspaceId,
            threadId: context.threadId,
            limit: args.limit ?? (format === 'detailed' ? 8 : 4),
          })
        : [];
      const confirmed = items.filter((item) => item.status === 'confirmed');
      const pending = items.filter((item) => item.status === 'pending');
      return {
        response_format: format,
        confirmed: formatList(confirmed, format, 4),
        pending: formatList(pending, format, 2),
        note: 'Pending experience is advisory only; do not auto-apply.',
      };
    },
  });

  registry.register({
    policy: basePolicy({
      toolName: 'read_platform_requirements',
      description:
        'Read platform publishing requirements (e.g. xiaohongshu). Policy facts only; not merchant-specific claims.',
      sideEffect: 'none',
      dataClasses: ['platform_policy'],
      maxCallsPerRun: 2,
      timeoutMs,
      inputSchema: readPlatformRequirementsArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = readPlatformRequirementsArgsSchema.parse(raw ?? {});
      const requirements = ports.readPlatformRequirements
        ? await ports.readPlatformRequirements({ platform: args.platform })
        : {
            platform: args.platform,
            rules: ['no_false_medical_claims', 'disclose_promotions'],
          };
      return {
        response_format: args.response_format,
        platform: args.platform,
        requirements,
      };
    },
  });

  registry.register({
    policy: basePolicy({
      toolName: 'read_model_capabilities',
      description:
        'Read available/unavailable deliverable capabilities for this workspace (no cost or provider secrets).',
      sideEffect: 'none',
      dataClasses: ['capability'],
      maxCallsPerRun: 2,
      timeoutMs,
      inputSchema: readModelCapabilitiesArgsSchema,
      isRetrieval: true,
    }),
    execute: async (raw) => {
      const args = readModelCapabilitiesArgsSchema.parse(raw ?? {});
      const caps = ports.readModelCapabilities
        ? await ports.readModelCapabilities({
            workspaceId: context.workspaceId,
          })
        : { available: ['copy', 'note'], unavailable: [] };
      return {
        response_format: args.response_format,
        ...caps,
      };
    },
  });

  return registry;
}

/**
 * Production port adapters: wrap product / store-fact / identity / memory / packages.
 * Each dependency is optional so fixture assembly can partial-wire.
 */
export function createSessionRetrievalPorts(deps: {
  product?: {
    load: (workspaceId: string) => Promise<{
      store?: {
        name?: string;
        confirmedAt?: string | null;
        projects?: Array<{
          id: string;
          name: string;
          confirmed?: boolean;
          /** StoreProject has no description; optional for port flexibility. */
          description?: string;
        }>;
      } | null;
      assets?: Array<{
        id: string;
        category?: string;
        authorizationStatus?: string;
        consentScope?: string;
        rightsEvidence?: string;
        rightsPlatforms?: string[];
        containsPerson?: boolean;
        sourceType?: string;
        tags?: string[];
      }>;
    } | null>;
  };
  storeFacts?: {
    listActive: (input: {
      workspaceId: string;
      scope: { storeId: string };
      at: string;
    }) => Promise<
      Array<{
        factId: string;
        kind: string;
        key: string;
        value: unknown;
        revision: number;
        expiresAt?: string | null;
      }>
    >;
  };
  identities?: {
    listActive: (
      workspaceId: string,
      at: string,
    ) => Promise<
      Array<{
        identityId?: string;
        id?: string;
        name?: string;
        displayName?: string;
        status?: string;
        summary?: string;
      }>
    >;
    project?: (
      workspaceId: string,
      actorId: string,
      at: string,
    ) => Promise<{
      defaultIdentity?: {
        identityId?: string;
        name?: string;
        summary?: string;
      } | null;
    }>;
  };
  contentPackages?: {
    list: (workspaceId: string) => Promise<
      Array<{
        packageId?: string;
        id?: string;
        title?: string;
        kind?: string;
        summary?: string;
        updatedAt?: string;
        status?: string;
      }>
    >;
  };
  experience?: {
    retrieveForInjection: (query: {
      workspaceId: string;
      scope: Record<string, unknown>;
      threadId?: string;
      limit?: number;
      injectionContext?: {
        taskId?: string;
        runId: string;
        harnessReleaseId: string;
      };
    }) => Promise<
      Array<{
        memoryId: string;
        statement: string;
        kind?: string;
        authority?: string;
      }>
    >;
  };
  now?: () => string;
  actorId?: string;
}): SessionRetrievalPorts {
  const now = deps.now ?? (() => new Date().toISOString());
  const actorId = deps.actorId ?? 'system';

  return {
    async listStoreProjects({ workspaceId, creationMode }) {
      if (creationMode === 'free' || !deps.product) return [];
      const state = await deps.product.load(workspaceId);
      const projects = state?.store?.projects ?? [];
      return projects
        .filter((project) => project.confirmed)
        .map((project) => ({
          ref: `project:${project.id}`,
          name: project.name,
          confirmed: true,
          ...(project.description ? { summary: project.description } : {}),
        }));
    },

    async listConfirmedStoreFacts({
      workspaceId,
      storeId,
      limit,
      creationMode,
    }) {
      if (creationMode === 'free' || !deps.storeFacts) return [];
      // Production fact scopes commonly pin storeId = workspaceId (see harness
      // production-context-port factScope). Product StoreProfile has no store id.
      const resolvedStoreId = storeId ?? workspaceId;
      const facts = await deps.storeFacts.listActive({
        workspaceId,
        scope: { storeId: resolvedStoreId },
        at: now(),
      });
      return facts.slice(0, limit ?? 20).map((fact) => ({
        ref: `fact:${fact.factId}@${fact.revision}`,
        kind: fact.kind,
        key: fact.key,
        value: fact.value,
        revision: fact.revision,
        freshness: fact.expiresAt ?? 'current',
      }));
    },

    async listAuthorizedAssets({ workspaceId, limit }) {
      if (!deps.product) return [];
      const state = await deps.product.load(workspaceId);
      const assets = state?.assets ?? [];
      return assets
        .filter(
          (asset) =>
            asset.authorizationStatus === 'authorized' &&
            asset.consentScope !== 'internal_only' &&
            Boolean(asset.rightsEvidence?.trim?.() ?? asset.rightsEvidence),
        )
        .slice(0, limit ?? 12)
        .map((asset) => ({
          ref: `asset:${asset.id}`,
          category: asset.category,
          description: (asset.tags ?? []).join(', ') || asset.category,
          rightsStatus: asset.authorizationStatus,
          allowedPlatforms: asset.rightsPlatforms,
          containsPerson: asset.containsPerson,
        }));
    },

    async readMarketingIdentity({ workspaceId }) {
      if (!deps.identities) return null;
      const at = now();
      if (deps.identities.project) {
        const projection = await deps.identities.project(
          workspaceId,
          actorId,
          at,
        );
        if (projection.defaultIdentity) {
          return {
            ref: projection.defaultIdentity.identityId
              ? `identity:${projection.defaultIdentity.identityId}`
              : undefined,
            name: projection.defaultIdentity.name,
            summary: projection.defaultIdentity.summary,
            isDefault: true,
            status: 'active',
          };
        }
      }
      const active = await deps.identities.listActive(workspaceId, at);
      const first = active[0];
      if (!first) return null;
      const id = first.identityId ?? first.id;
      return {
        ref: id ? `identity:${id}` : undefined,
        name: first.displayName ?? first.name,
        status: first.status ?? 'active',
        summary: first.summary,
        isDefault: true,
      };
    },

    async listRecentContent({ workspaceId, limit }) {
      if (!deps.contentPackages) return [];
      const packages = await deps.contentPackages.list(workspaceId);
      return packages.slice(0, limit ?? 6).map((item) => ({
        ref: `content:${item.packageId ?? item.id ?? 'unknown'}`,
        summary: item.summary ?? item.title ?? 'content',
        kind: item.kind,
        updatedAt: item.updatedAt,
      }));
    },

    async listConfirmedExperience({ workspaceId, threadId, limit }) {
      if (!deps.experience) return [];
      const injectionContext = currentMemoryInjectionTurnBinding();
      const entries = await deps.experience.retrieveForInjection({
        workspaceId,
        scope: {},
        threadId,
        limit: limit ?? 8,
        ...(injectionContext ? { injectionContext } : {}),
      });
      return entries.map((entry) => ({
        ref: `experience:${entry.memoryId}`,
        instruction: entry.statement,
        status:
          entry.authority === 'session'
            ? ('pending' as const)
            : ('confirmed' as const),
        kind: entry.kind,
      }));
    },

    async readPlatformRequirements({ platform }) {
      return {
        platform,
        maxImages: platform === 'xiaohongshu' ? 9 : 10,
        forbiddenClaims: ['absolute_cure', 'guaranteed_effect'],
        requiredDisclosures: ['promotion_window'],
      };
    },

    async readModelCapabilities() {
      return {
        available: ['copy', 'note', 'media'],
        unavailable: [],
      };
    },
  };
}
