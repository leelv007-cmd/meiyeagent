/**
 * ARCH-07A delivery/handoff/result controller.
 *
 * Public seam: publish handoff plus ResultAction navigation. Works does not
 * write delivery — this controller only mints a Result target/plan (writer:
 * 'result') and never executes result_export.
 */

import { useNavigate } from '@tanstack/react-router';
import type { ResultPanel } from '@meiye/contracts';

import {
  usePublishHandoff,
  type UsePublishHandoffInput,
  type UsePublishHandoffResult,
} from '@/product/agent-workbench/publish-handoff/use-publish-handoff';
import {
  resultActionForRevision,
  type ResultActionPlan,
} from '@/product/results/result-action';
import {
  navigateAfterSubmitSuccess,
  resultCenterLocationFromNavigation,
  type ResultCenterLocation,
} from '@/product/results/result-center-navigation';

import type { ComposerDeliveryOpenInput } from './composer-delivery-card';

export const COMPOSER_DELIVERY_ACTION_PANELS: Record<
  ComposerDeliveryOpenInput['action'],
  ResultPanel
> = {
  adjust: 'adjust',
  adopt: 'result',
  export: 'delivery',
  open: 'run',
};

export const COMPOSER_RESULT_CENTER_TO = '/dashboard/results/$workId' as const;

export type ComposerDeliveryPlan =
  | {
      kind: 'result_action';
      params: { workId: string };
      plan: ResultActionPlan;
      search: ResultCenterLocation['search'];
      to: typeof COMPOSER_RESULT_CENTER_TO;
    }
  | {
      kind: 'result_center';
      params: { workId: string };
      search: ResultCenterLocation['search'];
      to: typeof COMPOSER_RESULT_CENTER_TO;
      writer: 'result';
    };

export function planComposerDeliveryOpen(
  input: ComposerDeliveryOpenInput
): ComposerDeliveryPlan {
  if (input.action !== 'open' && input.revision) {
    const plan = resultActionForRevision(
      {
        contentId: input.revision.packageId,
        revision: input.revision.revision,
        versionId: input.revision.versionId,
        workId: input.workId,
      },
      input.action
    );
    const location = resultCenterLocationFromNavigation(
      { workId: plan.target.workId },
      {
        ...(plan.target.contentId ? { contentId: plan.target.contentId } : {}),
        ...(plan.target.panel ? { panel: plan.target.panel } : {}),
        ...(plan.target.versionId ? { versionId: plan.target.versionId } : {}),
        returnState: { kind: 'dashboard' },
        sourceRoute: '/dashboard',
      }
    );
    return {
      kind: 'result_action',
      params: { workId: plan.target.workId },
      plan,
      search: location.search,
      to: COMPOSER_RESULT_CENTER_TO,
    };
  }
  const location = navigateAfterSubmitSuccess({
    workId: input.workId,
    sourceRoute: '/dashboard',
    panel: COMPOSER_DELIVERY_ACTION_PANELS[input.action],
  });
  return {
    kind: 'result_center',
    params: { workId: input.workId },
    search: {
      ...location.search,
      ...(input.revision
        ? {
            contentId: input.revision.packageId,
            versionId: input.revision.versionId,
          }
        : {}),
    },
    to: COMPOSER_RESULT_CENTER_TO,
    writer: 'result',
  };
}

export type UseComposerDeliveryControllerInput = UsePublishHandoffInput;

export type UseComposerDeliveryControllerResult = UsePublishHandoffResult & {
  openDelivery: (input: ComposerDeliveryOpenInput) => void;
};

export function useComposerDeliveryController(
  input: UseComposerDeliveryControllerInput
): UseComposerDeliveryControllerResult {
  const navigate = useNavigate();
  const publishHandoff = usePublishHandoff(input);
  return {
    ...publishHandoff,
    openDelivery: (openInput) => {
      const planned = planComposerDeliveryOpen(openInput);
      void navigate({
        params: planned.params,
        replace: false,
        search: planned.search,
        to: planned.to,
      });
    },
  };
}
