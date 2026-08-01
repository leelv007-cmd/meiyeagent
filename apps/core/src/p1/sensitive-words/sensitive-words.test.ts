import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SENSITIVE_SCAN_LIMITS,
  type SensitiveWordRecord,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import {
  type HarnessPolicyInput,
  validateHarnessPolicy,
} from '../harness/policy-gates.js';
import {
  BEAUTY_FIXTURE_SENSITIVE_LEXICON,
  buildSensitiveCheckBar,
  MemorySensitiveWordsRepository,
  runGenerationChainSensitiveCheck,
  SensitiveScanLimitError,
  SensitiveWordsFoundationModule,
  scanSensitiveText,
} from './index.js';

const SAMPLE_COPY =
  '本店新客护理承诺根治色斑，绝对安全，一次见效，还能稳赚不赔。';

function lexiconEntry(
  id: string,
  word: string,
  status: SensitiveWordRecord['status'] = 'enabled'
): SensitiveWordRecord {
  const now = '2026-08-02T00:00:00.000Z';
  return {
    id,
    word,
    category: 'other',
    replacements: ['温和表述'],
    status,
    createdAt: now,
    updatedAt: now,
  };
}

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
  assert.equal(scan.complete, true);
  assert.ok(scan.hitCount >= 2, `expected hits, got ${scan.hitCount}`);
  const root = scan.hits.find((hit) => hit.word.includes('根治'));
  assert.ok(root);
  assert.ok(root.replacements.length > 0);
  assert.ok(root.replacements.some((item) => item.includes('改善')));

  const bar = buildSensitiveCheckBar({ text: SAMPLE_COPY, scan });
  assert.equal(bar.status, 'hits');
  assert.ok(bar.items.some((item) => item.replacements.length > 0));
});

test('scanner enforces public text and enabled-lexicon limits before matching', () => {
  const maxText = '清'.repeat(SENSITIVE_SCAN_LIMITS.maxTextLength);
  const maxLexicon = Array.from(
    { length: SENSITIVE_SCAN_LIMITS.maxEnabledWords },
    (_, index) => lexiconEntry(`limit-${index}`, `不存在-${index}`)
  );
  const atJointBoundary = scanSensitiveText(maxText, maxLexicon);
  assert.equal(atJointBoundary.complete, true);
  assert.equal(atJointBoundary.hitCount, 0);
  assert.equal(
    maxText.length * maxLexicon.length,
    SENSITIVE_SCAN_LIMITS.maxWorkUnits
  );

  assert.throws(
    () =>
      scanSensitiveText(
        `${maxText}超`,
        [lexiconEntry('one-enabled', '不存在')]
      ),
    (error) =>
      error instanceof SensitiveScanLimitError &&
      error.limitName === 'maxTextLength' &&
      error.limit === SENSITIVE_SCAN_LIMITS.maxTextLength &&
      error.observed === SENSITIVE_SCAN_LIMITS.maxTextLength + 1
  );
  assert.throws(
    () =>
      scanSensitiveText('', [
        ...maxLexicon,
        lexiconEntry('one-too-many', '额外词'),
      ]),
    (error) =>
      error instanceof SensitiveScanLimitError &&
      error.limitName === 'maxEnabledWords' &&
      error.observed === SENSITIVE_SCAN_LIMITS.maxEnabledWords + 1
  );

  const disabledOverflow = Array.from(
    { length: SENSITIVE_SCAN_LIMITS.maxEnabledWords + 1 },
    (_, index) => lexiconEntry(`disabled-${index}`, `停用-${index}`, 'disabled')
  );
  assert.equal(scanSensitiveText('普通正文', disabledOverflow).complete, true);
});

test('Foundation maps 50,001-unit query input to deterministic INVALID_STATE', async () => {
  const module = new SensitiveWordsFoundationModule(
    new MemorySensitiveWordsRepository([lexiconEntry('text-limit', '根治')])
  );
  const text = '清'.repeat(SENSITIVE_SCAN_LIMITS.maxTextLength + 1);
  for (const action of ['scan', 'check_bar', 'generation_chain_check']) {
    await assert.rejects(
      () =>
        module.query({
          context: ctx(),
          input: { action, payload: { text } },
        }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_STATE' &&
        /maxTextLength/u.test(error.message) &&
        !/Zod/u.test(error.name)
    );
  }
});

test('scanner rejects the first raw hit beyond its output budget without a partial result', () => {
  const lexicon = [lexiconEntry('raw-hit', '禁')];
  const atBoundary = scanSensitiveText(
    '禁'.repeat(SENSITIVE_SCAN_LIMITS.maxRawHits),
    lexicon
  );
  assert.equal(atBoundary.complete, true);
  assert.equal(atBoundary.hitCount, SENSITIVE_SCAN_LIMITS.maxRawHits);

  assert.throws(
    () =>
      scanSensitiveText(
        '禁'.repeat(SENSITIVE_SCAN_LIMITS.maxRawHits + 1),
        lexicon
      ),
    (error) =>
      error instanceof SensitiveScanLimitError &&
      error.limitName === 'maxRawHits' &&
      error.limit === SENSITIVE_SCAN_LIMITS.maxRawHits &&
      error.observed === SENSITIVE_SCAN_LIMITS.maxRawHits + 1
  );
});

test('scan and generation-chain queries share the same guarded enabled source', async () => {
  const rows = [lexiconEntry('shared-source', '根治')];
  const repository = new MemorySensitiveWordsRepository(rows);
  const module = new SensitiveWordsFoundationModule(repository);
  const direct = (await module.query({
    context: ctx(),
    input: { action: 'scan', payload: { text: '根治' } },
  })) as ReturnType<typeof scanSensitiveText>;
  const chain = (await module.query({
    context: ctx(),
    input: { action: 'generation_chain_check', payload: { text: '根治' } },
  })) as ReturnType<typeof runGenerationChainSensitiveCheck>;

  assert.equal(direct.complete, true);
  assert.deepEqual(chain.scan, direct);
  assert.equal(chain.scanner, 'scanSensitiveText');

  await assert.rejects(
    () =>
      module.query({
        context: ctx(),
        input: {
          action: 'generation_chain_check',
          payload: { text: '根治'.repeat(SENSITIVE_SCAN_LIMITS.maxRawHits + 1) },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'INVALID_STATE' &&
      /maxRawHits/u.test(error.message)
  );
  await assert.rejects(
    () =>
      module.query({
        context: ctx(),
        input: {
          action: 'scan',
          payload: { text: '根治'.repeat(SENSITIVE_SCAN_LIMITS.maxRawHits + 1) },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'INVALID_STATE' &&
      /maxRawHits/u.test(error.message)
  );
});

test('scan offsets remain UTF-16 ranges in the original text after NFKC matching', () => {
  const originalHit = 'e\u0301ﬃ';
  const text = `ﬃ前缀${originalHit}后缀`;
  const now = '2026-08-02T00:00:00.000Z';
  const lexicon: SensitiveWordRecord[] = [
    {
      id: 'unicode-compatibility-hit',
      word: 'éffi',
      category: 'other',
      replacements: ['温和表述'],
      status: 'enabled',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'unicode-overlapping-shorter-hit',
      word: 'é',
      category: 'other',
      replacements: ['普通表述'],
      status: 'enabled',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const scan = scanSensitiveText(text, lexicon);
  assert.equal(scan.hitCount, 1);
  assert.equal(scan.textLength, text.length);
  const hit = scan.hits[0];
  assert.ok(hit);
  assert.equal(hit.index, text.indexOf(originalHit));
  assert.equal(hit.length, originalHit.length);
  assert.equal(hit.word, originalHit);
  assert.equal(text.slice(hit.index, hit.index + hit.length), originalHit);

  const bar = buildSensitiveCheckBar({ text, scan });
  assert.equal(bar.items[0]?.word, originalHit);
  assert.ok(bar.items[0]?.snippet.includes(originalHit));
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
  assert.equal(sensitive.sensitiveCheckBar?.status, 'hits');
  assert.ok(
    sensitive.sensitiveCheckBar?.items.some(
      (item) => item.word.includes('根治') && item.replacements.length > 0,
    ),
  );

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
