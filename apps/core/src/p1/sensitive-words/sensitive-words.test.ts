import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BEAUTY_FIXTURE_SENSITIVE_LEXICON,
  MemorySensitiveWordsRepository,
  buildSensitiveCheckBar,
  runGenerationChainSensitiveCheck,
  scanSensitiveText,
  SensitiveWordsFoundationModule,
} from './index.js';
import {
  validateHarnessPolicy,
  type HarnessPolicyInput,
} from '../harness/policy-gates.js';
import type { P1Context } from '../foundation/domain.js';

const SAMPLE_COPY =
  '本店新客护理承诺根治色斑，绝对安全，一次见效，还能稳赚不赔。';

function ctx(): P1Context {
  return {
    workspaceId: 'workspace-ops',
    userId: 'platform-admin',
    correlationId: 'sensitive-words-test',
    actor: 'admin',
  };
}

function basePolicy(text: string): HarnessPolicyInput {
  return {
    phase: 'delivery',
    bundle: { workspaceId: 'workspace-1', revision: 1 },
    brief: {},
    candidate: {
      candidateId: 'c1',
      workspaceId: 'workspace-1',
      intendedUse: 'public_content',
      factClaims: [],
      assetRefs: [],
      visibleText: [{ field: 'body', text }],
    },
    sourceRefs: [],
    rightsRefs: [],
    identityRefs: [],
    sensitiveLexicon: [...BEAUTY_FIXTURE_SENSITIVE_LEXICON],
  };
}

test('fixture lexicon sample copy yields hits and replacement suggestions', () => {
  const scan = scanSensitiveText(SAMPLE_COPY, BEAUTY_FIXTURE_SENSITIVE_LEXICON);
  assert.ok(scan.hitCount >= 2, `expected hits, got ${scan.hitCount}`);
  const root = scan.hits.find((hit) => hit.word.includes('根治'));
  assert.ok(root);
  assert.ok(root.replacements.length > 0);
  assert.ok(root.replacements.some((item) => item.includes('改善')));

  const bar = buildSensitiveCheckBar({ text: SAMPLE_COPY, scan });
  assert.equal(bar.status, 'hits');
  assert.ok(bar.items.some((item) => item.replacements.length > 0));
});

test('generation-chain check and policy-gates share the same scanner + lexicon', () => {
  const lexicon = BEAUTY_FIXTURE_SENSITIVE_LEXICON;
  const chain = runGenerationChainSensitiveCheck({
    text: SAMPLE_COPY,
    lexicon,
  });
  assert.equal(chain.scanner, 'scanSensitiveText');
  assert.equal(chain.passed, false);
  assert.equal(chain.checkBar.status, 'hits');

  const policy = validateHarnessPolicy(basePolicy(SAMPLE_COPY));
  assert.equal(policy.passed, false);
  const sensitive = policy.failures.find(
    (failure) => failure.gateId === 'sensitive_words',
  );
  assert.ok(sensitive);
  assert.equal(sensitive.reason, '候选文案含有违禁词，已停止该候选。');
  assert.ok(sensitive.alternativePath.length > 0);

  const scanWords = new Set(chain.scan.hits.map((hit) => hit.word.toLowerCase()));
  // Shared lexicon identity: policy alternatives are replacements and/or hit hints.
  for (const suggestion of sensitive.alternativePath) {
    assert.ok(
      chain.scan.hits.some((hit) => hit.replacements.includes(suggestion)) ||
        suggestion.startsWith('命中：') ||
        suggestion.includes('替换') ||
        suggestion.includes('改写'),
      `unexpected alternative ${suggestion}`,
    );
  }
  assert.ok(scanWords.size > 0);
  assert.ok(
    sensitive.alternativePath.some((item) => item.startsWith('命中：')),
  );
});

test('CRUD behavior: create, list, update, disable, delete', async () => {
  const repository = new MemorySensitiveWordsRepository();
  const module = new SensitiveWordsFoundationModule(repository);
  const context = ctx();

  const created = (await module.execute({
    context,
    input: {
      action: 'create',
      payload: {
        word: '特效祛斑王',
        category: 'medical',
        replacements: ['色斑护理'],
        status: 'enabled',
      },
    },
  })) as { id: string; word: string };

  assert.equal(created.word, '特效祛斑王');

  const listed = (await module.query({
    context,
    input: { action: 'list', payload: { q: '祛斑' } },
  })) as { total: number; items: Array<{ id: string }> };
  assert.equal(listed.total, 1);

  const updated = (await module.execute({
    context,
    input: {
      action: 'update',
      payload: {
        id: created.id,
        status: 'disabled',
        replacements: ['专业色斑护理'],
      },
    },
  })) as { status: string; replacements: string[] };
  assert.equal(updated.status, 'disabled');
  assert.deepEqual(updated.replacements, ['专业色斑护理']);

  const enabledScan = (await module.query({
    context,
    input: {
      action: 'scan',
      payload: { text: '本店特效祛斑王项目' },
    },
  })) as { hitCount: number };
  assert.equal(enabledScan.hitCount, 0);

  await module.execute({
    context,
    input: { action: 'update', payload: { id: created.id, status: 'enabled' } },
  });
  const afterEnable = (await module.query({
    context,
    input: {
      action: 'scan',
      payload: { text: '本店特效祛斑王项目' },
    },
  })) as { hitCount: number };
  assert.equal(afterEnable.hitCount, 1);

  const deleted = (await module.execute({
    context,
    input: { action: 'delete', payload: { id: created.id } },
  })) as { deleted: true };
  assert.equal(deleted.deleted, true);

  await assert.rejects(
    () =>
      module.execute({
        context,
        input: { action: 'delete', payload: { id: created.id } },
      }),
    /not found/i,
  );
});

test('platform baseline seed is beauty fixture, not empty', async () => {
  const repository = new MemorySensitiveWordsRepository();
  const first = await repository.ensurePlatformBaseline();
  assert.equal(first.seeded, BEAUTY_FIXTURE_SENSITIVE_LEXICON.length);
  const second = await repository.ensurePlatformBaseline();
  assert.equal(second.seeded, 0);
  const enabled = await repository.listEnabled();
  assert.ok(enabled.some((row) => row.category === 'medical'));
  assert.ok(enabled.every((row) => row.id.startsWith('sw-')));
});

test('clear copy produces clear check bar and policy pass for sensitive gate', () => {
  const text = '周末到店做一次温和补水护理，皮肤更水润。';
  const chain = runGenerationChainSensitiveCheck({
    text,
    lexicon: BEAUTY_FIXTURE_SENSITIVE_LEXICON,
  });
  assert.equal(chain.passed, true);
  assert.equal(chain.checkBar.status, 'clear');

  const policy = validateHarnessPolicy(basePolicy(text));
  assert.equal(
    policy.failures.some((failure) => failure.gateId === 'sensitive_words'),
    false,
  );
});

test('policy-gates without sensitiveLexicon does not invent hits (redline compat)', () => {
  const policy = validateHarnessPolicy({
    ...basePolicy(SAMPLE_COPY),
    sensitiveLexicon: undefined,
  });
  assert.equal(
    policy.failures.some((failure) => failure.gateId === 'sensitive_words'),
    false,
  );
});
