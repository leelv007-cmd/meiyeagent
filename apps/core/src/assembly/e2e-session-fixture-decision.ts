/**
 * E2E Composer Session-kernel fixture decisions (APP_ENV=e2e only).
 *
 * V31-28: since V31-14/25 a frozen-snapshot Make never re-opens guidance gaps
 * (`make-snapshot-consume.ts`), so the free-copy guidance question lives in
 * the plan phase. Trigger authority is split by prompt shape (2026-08-12
 * adjudication): a promotion / missing-price intent always hits the Brief
 * high-risk gate first (informed consent, deliver-first — the Day-0 contract),
 * so the plan-phase question deliberately does NOT fire for it. What asks in
 * the plan phase is the *vague* guidance intent — no industry word, no
 * promotion word, no assets, nothing for the Brief's fact analysis to flag —
 * mirroring the model-supply intent-naming fixture's guidance route
 * (`ai-sdk-runner.ts` `harness_intent_naming_v1`, industry_category gap). The
 * answer turn (recognised by the durable `clarificationAnswerTurnMessage`
 * shape) proposes the copy plan carrying the merchant's answer.
 *
 * Every other prompt keeps the pre-existing behavior exactly: `三页`
 * image-text prompts propose the three-page note plan; everything else
 * finishes the turn so the coordinator compiles the submission it was given.
 */

import { splitClarificationAnswerTurnMessage } from '../p1/agent-session/composer-plan-session.js';
import type { AgentTurnDecision } from '../p1/agent-session/turn-contracts.js';

const PROMOTION_PATTERN = /团购|优惠|套餐/u;
const INDUSTRY_PATTERN = /美发|美甲|护理|皮肤|美容|发型|染发/u;
/** The merchant asked for "something" — nothing names what to write about. */
const VAGUE_PATTERN = /随便|写点|来点|看着办|都行/u;

/** Mirrors `fallbackGuidanceGap` industry_category (ai-sdk-runner fixture). */
export const E2E_GUIDANCE_QUESTION = '这次内容主要属于哪一类美业服务？';
export const E2E_GUIDANCE_ITEM_ID = 'industry_category';

/**
 * Vague guidance intent: asks in the plan phase. Promotion-worded intents are
 * excluded on purpose — their missing price is the Brief high-risk gate's
 * jurisdiction and must not be asked twice.
 */
export function isVagueGuidanceIntent(text: string): boolean {
  return (
    VAGUE_PATTERN.test(text) &&
    !INDUSTRY_PATTERN.test(text) &&
    !PROMOTION_PATTERN.test(text)
  );
}

type FixturePromptProjection = {
  merchantRequest?: { text?: unknown };
  assets?: unknown[];
};

function projectionFromPrompt(prompt: string): FixturePromptProjection {
  try {
    const parsed = JSON.parse(prompt) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as FixturePromptProjection)
      : {};
  } catch {
    return {};
  }
}

const FINISH_TURN_DECISION: AgentTurnDecision = {
  merchantMessage: 'fixture-session-turn',
  action: { kind: 'finish_turn' },
  evidenceRefs: [],
  assumptions: [],
};

/** The one Composer Session-kernel fixture decision (assembly-level). */
export function e2eSessionFixtureDecision(request: {
  prompt: string;
}): AgentTurnDecision {
  if (/三页|3\s*页/u.test(request.prompt)) {
    return {
      merchantMessage: 'E2E three-page plan fixture',
      action: {
        kind: 'propose_plan',
        proposal: {
          goalNarrative: /图文持续冲突样本/u.test(request.prompt)
            ? '图文持续冲突样本'
            : 'Create a three-page merchant content plan.',
          recommendedDeliverables: [
            {
              carrier: 'note',
              platform: 'xiaohongshu',
              quantity: 3,
              purpose: 'Three-page image-text note',
            },
          ],
          expressionStrategy: {},
          factIntentions: [],
          assetIntentions: [],
        },
      },
      evidenceRefs: [],
      assumptions: [],
    };
  }
  const projection = projectionFromPrompt(request.prompt);
  const merchantText =
    typeof projection.merchantRequest?.text === 'string'
      ? projection.merchantRequest.text
      : '';
  const answered = splitClarificationAnswerTurnMessage(merchantText);
  if (answered) {
    // A clarification answer must always produce a plan in fixture mode — a
    // second finish_turn would fail the waiting run with no exit.
    return {
      merchantMessage: '已根据你的补充更新这次的创作方案',
      action: {
        kind: 'propose_plan',
        proposal: {
          goalNarrative: `${answered.intentText}（补充：${answered.merchantAnswer}）`,
          recommendedDeliverables: [
            { carrier: 'copy', quantity: 1, purpose: '发布文案' },
          ],
          expressionStrategy: {},
          factIntentions: [],
          assetIntentions: [],
        },
      },
      evidenceRefs: [],
      assumptions: [],
    };
  }
  const hasAssets =
    Array.isArray(projection.assets) && projection.assets.length > 0;
  if (isVagueGuidanceIntent(merchantText) && !hasAssets) {
    return {
      merchantMessage: E2E_GUIDANCE_QUESTION,
      action: {
        kind: 'ask_merchant',
        question: {
          itemId: E2E_GUIDANCE_ITEM_ID,
          question: E2E_GUIDANCE_QUESTION,
        },
      },
      evidenceRefs: [],
      assumptions: [],
    };
  }
  return FINISH_TURN_DECISION;
}
