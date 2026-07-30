import type {
  CopywritingCandidateFixture,
  CopywritingPromptfooVars,
} from './cases.js';

export function scoreCopywritingCandidate(
  candidate: CopywritingCandidateFixture,
  vars: CopywritingPromptfooVars
) {
  const text = `${candidate.title}\n${candidate.body}`;
  const allowedFactRefs = new Set(
    JSON.parse(vars.allowedFactRefsJson) as string[]
  );
  const expectedFragments = JSON.parse(vars.expectedFragmentsJson) as string[];
  const forbiddenFragments = JSON.parse(
    vars.forbiddenFragmentsJson
  ) as string[];
  const failures = [
    ...(candidate.conversionHook === '私信预约'
      ? []
      : ['The CTA differs from the confirmed conversion action.']),
    ...candidate.factClaims
      .filter(
        (claim) => !claim.sourceRef || !allowedFactRefs.has(claim.sourceRef)
      )
      .map(
        (claim) => `Unauthorized fact claim: ${claim.sourceRef ?? '<missing>'}`
      ),
    ...forbiddenFragments
      .filter((fragment) => text.includes(fragment))
      .map((fragment) => `Forbidden claim fragment: ${fragment}`),
  ];
  const score =
    (candidate.conversionHook === '私信预约' ? 1 : 0) +
    expectedFragments.filter((fragment) => text.includes(fragment)).length +
    candidate.factClaims.filter(
      (claim) => claim.sourceRef && allowedFactRefs.has(claim.sourceRef)
    ).length;
  return { failures, score };
}
