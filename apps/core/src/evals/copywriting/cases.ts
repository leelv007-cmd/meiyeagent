const EXACT_SCORER =
  'file://apps/core/src/evals/copywriting/promptfoo-scorer.ts';

export interface CopywritingCandidateFixture {
  assetRefs: string[];
  body: string;
  conversionHook: string;
  expressionIdentityRef?: string;
  factClaims: Array<{
    kind: 'price' | 'benefit' | 'qualification' | 'offer' | 'other';
    sourceRef?: string;
    value: string;
  }>;
  title: string;
}

export interface CopywritingPromptfooVars {
  allowedFactRefsJson: string;
  baselineOutputJson: string;
  caseId: string;
  catalogRevision: string;
  expectedConclusion: 'improved' | 'unchanged' | 'regressed';
  expectedFragmentsJson: string;
  forbiddenFragmentsJson: string;
  promptContentHash: string;
  promptName: string;
  promptVersion: string;
  skillRevisionRef: string;
}

export interface CopywritingPromptfooCase {
  description: string;
  assert: Array<{ type: 'javascript'; value: string }>;
  vars: CopywritingPromptfooVars;
}

export const COPYWRITING_CASES: CopywritingPromptfooCase[] = [
  {
    description:
      'Recorded single-variable arms change only Skill instructions through the production generation seam',
    assert: [{ type: 'javascript', value: EXACT_SCORER }],
    vars: {
      allowedFactRefsJson: JSON.stringify(['store_fact:service-hydration:1']),
      baselineOutputJson: JSON.stringify({
        assetRefs: [],
        body: '深层补水护理围绕已确认的换季干燥需求，让顾客先看懂这次护理解决什么困扰，再决定是否到店。',
        conversionHook: '私信预约',
        expressionIdentityRef: 'identity-owner-260',
        factClaims: [
          {
            kind: 'benefit',
            sourceRef: 'store_fact:service-hydration:1',
            value: '围绕已确认的换季干燥需求进行深层补水护理',
          },
        ],
        title: '换季干燥时，认真补一次水',
      } satisfies CopywritingCandidateFixture),
      caseId: 'hydration-project-introduction',
      catalogRevision: 'catalog-recorded-cn-copy@1',
      expectedConclusion: 'unchanged',
      expectedFragmentsJson: JSON.stringify(['深层补水护理', '换季干燥']),
      forbiddenFragmentsJson: JSON.stringify([
        '百分百',
        '治愈',
        '限时',
        '立减',
      ]),
      promptContentHash:
        'b3d9c8a52bb051345653e238da62c7a20c438115a5d56b66459898a0c7ad4f74',
      promptName: 'harness/copy-candidate',
      promptVersion: '260-recorded',
      skillRevisionRef: 'skill.beauty-copywriting@1',
    },
  },
];

export default COPYWRITING_CASES;
