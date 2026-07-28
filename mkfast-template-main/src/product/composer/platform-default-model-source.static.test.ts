/**
 * #240① — the platform default model has exactly one source, and reusing it is
 * never silent.
 *
 * The defect: `COMPOSER_PLATFORM_DEFAULT_MODEL_BY_LENS` in `composer-live.ts`
 * hardcoded copy→deepseek-v4-pro / image_text→seedream-5-pro / video→seedance-2
 * in the browser bundle. Operations set the real value in admin config
 * (`platform.defaultModel.<configKey>`, D-044); that value is what Day-0
 * provisioning writes into the workspace default and what activation evidence
 * validates. The client copy answered to none of that — an operator switching
 * the platform image default would have moved provisioning and left every
 * unprovisioned composer session on the old model, with nothing anywhere saying
 * so. It was also unvalidated: the constant could name a model with no platform
 * activation evidence at all, which core would refuse as a default.
 *
 * A behavioural test cannot prove the *absence* of a second table, so this is a
 * static assertion 門 (testing decision 9): the value crosses every production
 * selection seam, while behavioural and PostgreSQL tests prove the values.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const WEB_SRC = fileURLToPath(new URL('../../', import.meta.url));

function read(relativePath: string) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8'
  );
}

/**
 * Code only. The comment explaining why a table was removed necessarily names
 * the table, and a gate that cannot tell prose from a declaration would forbid
 * writing that explanation down.
 */
function code(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

function webSourceFiles() {
  return readdirSync(WEB_SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.tsx?$/u.test(entry))
    .filter((entry) => !/\.test\.tsx?$/u.test(entry))
    .filter((entry) => !entry.includes('routeTree.gen'));
}

const composerHome = read('./composer-home.tsx');
const composerLive = read('./composer-live.ts');
const settingsViewModel = read('../../p1/settings-view-model.ts');
const selection = read('../../p1/model-current-selection.ts');
const corePreferenceView = read(
  '../../../../apps/core/src/p1/model-supply/catalog.ts'
);
const coreControlPlane = read(
  '../../../../apps/core/src/p1/model-supply/foundation-module.ts'
);
const coreMain = read('../../../../apps/core/src/main.ts');
const coreCopyProvider = read(
  '../../../../apps/core/src/product/model-supply-copy-provider.ts'
);
const coreWorkspaceProvision = read(
  '../../../../apps/core/src/p1/foundation/workspace-provision.ts'
);
const coreExecutionSnapshot = read(
  '../../../../apps/core/src/p1/execution-spine/creation-execution-snapshot.ts'
);
const coreAdmission = read(
  '../../../../apps/core/src/p1/execution-spine/composer-submission-gate.ts'
);
const coreSubmissionStore = read(
  '../../../../apps/core/src/p1/execution-spine/postgres-creation-submission-store.ts'
);

test('the retired browser-side lens→model table stays retired', () => {
  const survivors = webSourceFiles().filter((file) =>
    code(readFileSync(`${WEB_SRC}${file}`, 'utf8')).includes(
      'COMPOSER_PLATFORM_DEFAULT_MODEL_BY_LENS'
    )
  );
  assert.deepEqual(
    survivors,
    [],
    'the platform default belongs to admin config, not to a client constant'
  );
});

test('no web module maps a creation lens onto a production model id', () => {
  // The shape that came back would be a `Record<CreationLensId, string>` of
  // catalog model ids. `COMPOSER_OPERATION_BY_LENS` (lens → operation name) is
  // the legitimate lens table and carries no model id, so the assertion is on
  // model ids specifically.
  const modelIdByLens =
    /(?:copy|image_text|video)\s*:\s*'(?:deepseek|seedream|seedance|gpt-image|llm-)[a-z0-9.-]*'/u;
  const offenders = webSourceFiles().filter((file) =>
    modelIdByLens.test(code(readFileSync(`${WEB_SRC}${file}`, 'utf8')))
  );
  assert.deepEqual(
    offenders,
    [],
    'a second hardcoded lens→model table is the exact defect #240① removed'
  );
});

test('the composer takes the platform default from the server projection', () => {
  assert.match(
    composerHome,
    /platformDefault: preferences\.platformDefault,/u,
    'the platform default arrives with the preferences, from one source'
  );
  assert.match(
    settingsViewModel,
    /const platformDefault = string\(payload\.platformDefault\);/u
  );
  assert.doesNotMatch(
    settingsViewModel,
    /platformDefault\s*\?\?\s*'/u,
    'normalization must not paper over a missing default with a literal'
  );
});

test('composer-live keeps no platform default of its own', () => {
  assert.doesNotMatch(
    code(composerLive),
    /PLATFORM_DEFAULT/u,
    'the module that held the constant must not grow a replacement'
  );
  // The lens→operation table is the one lens map that legitimately lives here.
  assert.match(composerLive, /COMPOSER_OPERATION_BY_LENS = \{/u);
});

test('the other end of the seam: core projects the platform default', () => {
  assert.match(
    corePreferenceView,
    /export interface PreferenceView \{[\s\S]*?platformDefaultRevision\?: string;/u,
    'if this field moves, the browser read above must move with it'
  );
  assert.match(
    coreControlPlane,
    /platformDefaultModelConfigKeyForOperation\(operation\)/u,
    'the projection resolves the config key from the canonical table'
  );
  assert.match(
    coreControlPlane,
    /if \(!this\.platformDefaultModels \|\| !configKey\) return view;/u,
    'an unconfigured platform default is reported as absent, not substituted'
  );
});

test('the resolution still refuses to guess when nothing is configured', () => {
  assert.match(
    selection,
    /const platformDefault = eligible\(input\.platformDefault\);/u
  );
  assert.match(
    selection,
    /return undefined;\s*\}/u,
    'no executable configured default means no selection — not the first model'
  );
});

test('all production copy selection points consume canonical preferences', () => {
  assert.doesNotMatch(
    code(coreMain),
    /DOMESTIC_COPY_CATALOG_MODEL_ID|deepseek-v4-pro/u,
    'the composition root must not carry a fixed copy fallback'
  );
  assert.match(
    coreMain,
    /return resolveCanonicalCopySelection\(preferences\);/u
  );
  assert.doesNotMatch(code(coreCopyProvider), /deepseek-v4-pro/u);
  assert.match(
    coreCopyProvider,
    /preferences\.platformDefault;[\s\S]*?No canonical copy model is configured\./u,
    'copy must consume the platform preference and fail closed when absent'
  );
});

test('server-owned provenance is frozen and projected from persistence', () => {
  assert.doesNotMatch(
    composerHome,
    /catalogModelSource/u,
    'the browser must not claim an audit source in its draft'
  );
  assert.match(
    coreWorkspaceProvision,
    /origin: 'platform_default',[\s\S]*?platformConfigRevision:/u,
    'Day-0 writes retain platform origin and config revision'
  );
  assert.match(
    coreAdmission,
    /deriveModelSelection\([\s\S]*?modelSelection,/u,
    'admission derives selection provenance before the coordinator freezes it'
  );
  assert.match(
    coreExecutionSnapshot,
    /modelSelection: frozenModelSelectionSchema\.optional\(\)/u,
    'the immutable snapshot owns the strict provenance tuple'
  );
  assert.match(
    coreSubmissionStore,
    /creationExecutionSnapshot: \{[\s\S]*?modelSelection: snapshot\.modelSelection/u,
    'the persisted ContentPackage read projection exposes the frozen tuple'
  );
});
