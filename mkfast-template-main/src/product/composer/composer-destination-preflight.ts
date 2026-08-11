import type { ComposerDestinationMapping } from '@meiye/contracts';

export type ComposerDestinationPreflightState = {
  intent: string;
  result: ComposerDestinationMapping;
};

export type ComposerDestinationPreflightDecision =
  | { kind: 'continue' }
  | { destination: string; kind: 'map' }
  | {
      kind: 'block';
      result: Extract<
        ComposerDestinationMapping,
        { status: 'needs_clarification' }
      >;
    };

type ComposerDestinationSelection = {
  contentPackagePlatform?: string | null;
  distributionTarget?: string | null;
};

const DESTINATION_SIGNAL =
  /发到|发布|发给|用在|投放|小红书|抖音|视频号|朋友圈|线下|店内|立牌|海报|导出|下载|复制|代发|协助/u;

export function composerIntentMentionsDestination(intent: string): boolean {
  return DESTINATION_SIGNAL.test(intent);
}

export function decideComposerDestinationPreflight(input: {
  appliedRecipeDestination?: ComposerDestinationSelection;
  currentDestination?: ComposerDestinationSelection;
  hasExplicitDestination: boolean;
  intent: string;
  state: ComposerDestinationPreflightState | null;
}): ComposerDestinationPreflightDecision {
  const boundDestinationIsCurrent =
    typeof input.appliedRecipeDestination?.contentPackagePlatform ===
      'string' &&
    typeof input.appliedRecipeDestination.distributionTarget === 'string' &&
    input.currentDestination?.contentPackagePlatform ===
      input.appliedRecipeDestination.contentPackagePlatform &&
    input.currentDestination.distributionTarget ===
      input.appliedRecipeDestination.distributionTarget;
  if (input.hasExplicitDestination || boundDestinationIsCurrent) {
    return { kind: 'continue' };
  }

  const destination = input.intent.trim();
  if (input.state?.intent === destination) {
    if (input.state.result.status === 'needs_clarification') {
      return { kind: 'block', result: input.state.result };
    }
    return { kind: 'continue' };
  }
  if (!composerIntentMentionsDestination(destination)) {
    return { kind: 'continue' };
  }
  return { destination, kind: 'map' };
}
