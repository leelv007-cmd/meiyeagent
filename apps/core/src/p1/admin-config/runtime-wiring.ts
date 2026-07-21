import {
  modelMediaExecutionMode,
  modelRuntimeAssemblyFromEnv,
} from '../model-supply/runtime-config.js';
import { P1DomainError } from '../foundation/domain.js';
import type { AdminConfigRepository } from './foundation-module.js';
import type { RuntimeProcessKind } from './foundation-module.js';
import type { ActivationEvidence } from '../model-supply/catalog.js';

const GLOBAL_WORKSPACE_ID = '__global__';

export function runtimeModeValidatorsFromProviderCredentials(
  providerCredentialRuntime: { env: NodeJS.ProcessEnv },
) {
  const env = providerCredentialRuntime.env;
  const validate = (override: NodeJS.ProcessEnv) => {
    try {
      modelRuntimeAssemblyFromEnv({ ...env, ...override });
    } catch (error) {
      throw new P1DomainError(
        'INVALID_STATE',
        error instanceof Error ? error.message : 'Runtime mode is not assemblable.',
      );
    }
  };
  return {
    'model.execution.mode': (value: unknown) =>
      validate({ MODEL_EXECUTION_MODE: String(value) }),
    'model.media.execution.mode': (value: unknown) =>
      validate({ MODEL_MEDIA_EXECUTION_MODE: String(value) }),
  };
}

export type RuntimeConfigSource =
  | { source: 'db_revision'; revision: number }
  | { source: 'env_fallback'; revision?: never };

export async function modelRuntimeAssemblyFromSources(
  repository: AdminConfigRepository,
  env: NodeJS.ProcessEnv,
  options: {
    clock?: () => Date;
    processKind?: RuntimeProcessKind;
  } = {},
) {
  const assembleFromEnvAndEvidence = async (sourcedEnv: NodeJS.ProcessEnv) => {
    const base = modelRuntimeAssemblyFromEnv(sourcedEnv);
    const evidenceRows = await Promise.all(
      base.deployments.map(async (deployment) => [
        deployment.id,
        await repository.get(
          'global',
          GLOBAL_WORKSPACE_ID,
          `model.activation.evidence.${deployment.id}`,
        ),
      ] as const),
    );
    const evidence = Object.fromEntries(
      evidenceRows.flatMap(([deploymentId, revision]) =>
        revision
          ? [[deploymentId, revision.value as ActivationEvidence] as const]
          : [],
      ),
    );
    return modelRuntimeAssemblyFromEnv(sourcedEnv, evidence);
  };
  const assemble = async () => {
    try {
      const fixtureRuntime =
        env.APP_ENV === 'e2e' && env.MODEL_EXECUTION_MODE === 'fixture';
      const [execution, media] = await Promise.all([
        fixtureRuntime
          ? Promise.resolve(undefined)
          : repository.get(
              'global',
              GLOBAL_WORKSPACE_ID,
              'model.execution.mode'
            ),
        fixtureRuntime
          ? Promise.resolve(undefined)
          : repository.get(
              'global',
              GLOBAL_WORKSPACE_ID,
              'model.media.execution.mode'
            ),
      ]);
      const sourcedEnv = {
        ...env,
        ...(execution
          ? { MODEL_EXECUTION_MODE: String(execution.value) }
          : {}),
        ...(media ? { MODEL_MEDIA_EXECUTION_MODE: String(media.value) } : {}),
      };
      try {
        return {
          assembly: await assembleFromEnvAndEvidence(sourcedEnv),
          sources: {
            execution: execution
              ? ({ source: 'db_revision', revision: execution.revision } as const)
              : ({ source: 'env_fallback' } as const),
            media: media
              ? ({ source: 'db_revision', revision: media.revision } as const)
              : ({ source: 'env_fallback' } as const),
          },
          fallbackReason: null,
        };
      } catch (error) {
        return {
          assembly: await assembleFromEnvAndEvidence(env),
          sources: {
            execution: { source: 'env_fallback' } as const,
            media: { source: 'env_fallback' } as const,
          },
          fallbackReason:
            error instanceof Error
              ? error.message
              : 'Stored runtime config is invalid.',
        };
      }
    } catch (error) {
      return {
        assembly: modelRuntimeAssemblyFromEnv(env),
        sources: {
          execution: { source: 'env_fallback' } as const,
          media: { source: 'env_fallback' } as const,
        },
        fallbackReason:
          error instanceof Error ? error.message : 'Config repository is unavailable.',
      };
    }
  };
  const result = await assemble();
  if (options.processKind) {
    for (const warning of result.assembly.warnings) {
      console.warn(`[model-runtime] ${warning.message}`);
    }
    await repository.upsertEffectiveSnapshot({
      bootedAt: (options.clock?.() ?? new Date()).toISOString(),
      executionMode: result.assembly.runtime.mode,
      executionSource: result.sources.execution,
      fallbackReason: result.fallbackReason,
      mediaMode: modelMediaExecutionMode(result.assembly.runtime),
      mediaSource: result.sources.media,
      processKind: options.processKind,
    });
  }
  return result;
}

export async function integrationAdapterEnvFromSources(
  repository: AdminConfigRepository,
  env: NodeJS.ProcessEnv,
) {
  if (env.APP_ENV === 'e2e' && env.MODEL_EXECUTION_MODE === 'fixture') {
    return {
      env: { ...env, BYOK_EXECUTION_MODE: 'recorded' },
      byokSource: { source: 'env_fallback' } as const,
      douyinMode: 'recorded' as const,
    };
  }
  try {
    const byok = await repository.get(
      'global',
      GLOBAL_WORKSPACE_ID,
      'byok.adapter.assembly',
    );
    return {
      env: byok
        ? { ...env, BYOK_EXECUTION_MODE: String(byok.value) }
        : env,
      byokSource: byok
        ? ({ source: 'db_revision', revision: byok.revision } as const)
        : ({ source: 'env_fallback' } as const),
      douyinMode: 'recorded' as const,
    };
  } catch {
    return {
      env,
      byokSource: { source: 'env_fallback' } as const,
      douyinMode: 'recorded' as const,
    };
  }
}
