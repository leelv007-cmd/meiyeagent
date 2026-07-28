# Canonical platform default model map

Scope: #240①, D-044, D-150. This map distinguishes production decisions from
fixture-only values and names both ends of every delivered seam.

| Role | Source / consumer | Production fact |
|---|---|---|
| Canonical vocabulary | `apps/core/src/p1/foundation/workspace-provision.ts` | One tuple derives config keys, operations, and both lookup directions. |
| Canonical value + revision | `apps/core/src/main.ts` | `platformDefaultModelSource` reads `platform.defaultModel.<modality>` from governed admin config and returns the catalog model id with its config revision. |
| Day-0 write | `apps/core/src/p1/foundation/workspace-provision.ts` | Provisioning validates every entitled modality, then writes the preference with `origin=platform_default` and the platform config revision. |
| Preference persistence | `apps/core/src/p1/model-supply/postgres-repository.ts` | `model_workspace_preferences` stores model id, origin, and platform config revision. A platform-origin row is audit evidence and is not projected as a merchant workspace default. |
| Composer preference projection | `apps/core/src/p1/model-supply/foundation-module.ts` → `mkfast-template-main/src/product/composer/composer-home.tsx` | Core projects the current canonical platform model + revision; Web resolves it only after explicit, user, and merchant-workspace choices. |
| ProductService copy consumer | `apps/core/src/main.ts` → `apps/core/src/product/model-supply-copy-provider.ts` | Copy uses the same preference projection. No configured user/workspace/platform model fails closed; there is no production fixed-model fallback. |
| Server provenance decision | `apps/core/src/p1/execution-spine/composer-submission-gate.ts` | Admission derives the strict source enum from server preferences and binds the selected catalog model. Platform fallback also requires the config revision. |
| Immutable persistence | `apps/core/src/p1/execution-spine/creation-execution-snapshot.ts` → `apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts` | The model id, source enum, and platform config revision are frozen in the submission snapshot; ContentPackage exposes the persisted tuple as a read projection. |
| Replay identity | `apps/core/src/p1/execution-spine/submission-coordinator.ts` | Provenance is server-owned and outside the browser receipt hash. Exact retry returns the original frozen snapshot before mutable admission is rerun. |

## Fixture exceptions

- `E2E_PLATFORM_DEFAULT_MODEL_*` is accepted only under `APP_ENV=e2e` with the
  fixture execution mode. Its revision is deterministic
  `runtime-default:<config-key>:<catalog-model-id>`.
- The image E2E default is `nano-banana-2`, intentionally different from the
  retired Web constant `seedream-5-pro`. It exists in the real catalog and has a
  fixture-executable deployment.
- Catalog model and deployment definitions are inventory, not default
  decisions. Their model-id literals are therefore not fallback exceptions.

## Guards

- Core behaviour: `platform-default-preference.test.ts`,
  `model-supply-copy-provider.test.ts`,
  `workspace-provision.test.ts`, `composer-submission-gate.test.ts`,
  `composer-http.test.ts`, and the PostgreSQL repository suites.
- Cross-repository anti-revival:
  `mkfast-template-main/src/product/composer/platform-default-model-source.static.test.ts`.
- Branch journey:
  `mkfast-template-main/tests/e2e/specs/image-text-note-compiler.spec.ts`
  proves preferences → Composer submission → completed Harness workflow →
  persisted ContentPackage provenance readback.
