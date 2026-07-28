import type {
  CopyProvider,
  CopyProviderRequest,
  CopyProviderResult,
} from './copy-provider.js';
import type {
  PreferenceView,
  RequestedSelection,
} from '../p1/model-supply/index.js';
import type { BeautyCopyPromptRevision } from '../p1/model-supply/quality-evaluation.js';
import { ProductCopyProviderBridge } from '../p1/model-supply/index.js';
import { BEAUTY_COPY_PROMPT } from './copy-prompt-library.js';

export function resolveCanonicalCopySelection(
  preferences: PreferenceView,
): RequestedSelection {
  const catalogModelId =
    preferences.userDefault ??
    preferences.workspaceDefault ??
    preferences.platformDefault;
  if (!catalogModelId) {
    throw new Error('No canonical copy model is configured.');
  }
  return { catalogModelId, mode: 'fixed' };
}

export class ModelSupplyProductCopyProvider implements CopyProvider {
  readonly name = 'model-supply';
  readonly model: string;

  constructor(
    private readonly bridge: ProductCopyProviderBridge,
    private readonly selection: RequestedSelection | undefined,
    readonly region: CopyProvider['region'],
    private readonly resolveSelection?: (
      request: CopyProviderRequest
    ) => Promise<RequestedSelection | undefined>,
    private readonly resolvePrompt?: (
      request: CopyProviderRequest
    ) => Promise<BeautyCopyPromptRevision>
  ) {
    this.model =
      selection?.mode === 'fixed'
        ? (selection.catalogModelId ?? 'fixed-model')
        : 'llm-auto-quality';
  }

  async generate(request: CopyProviderRequest): Promise<CopyProviderResult> {
    const promptRevision =
      (await this.resolvePrompt?.(request)) ?? BEAUTY_COPY_PROMPT;
    const selection =
      (request.brief.requestedSelection as RequestedSelection | undefined) ??
      (await this.resolveSelection?.(request)) ??
      this.selection;
    if (!selection) {
      throw new Error('No canonical copy model is configured.');
    }
    const result = await this.bridge.generate({
      actorId: request.userId,
      correlationId: request.correlationId,
      dataClass: [...request.dataClasses],
      exampleSetRevision: promptRevision.exampleSetRevision,
      idempotencyKey: request.idempotencyKey,
      copyCandidateCount: 3,
      prompt: JSON.stringify({
        assets: request.assets.map((asset) => ({
          id: asset.id,
          tags: asset.tags,
        })),
        brief: request.brief,
        grounding: {
          city: request.store.city,
          name: request.store.name,
          price: request.store.project.price,
          project: request.store.project.name,
        },
        instructions: {
          ...promptRevision.instructions,
          tone: request.store.brandVoice,
        },
        fewShots: promptRevision.fewShots,
      }),
      promptRevision: promptRevision.promptRevision,
      requestedSelection: selection,
      workspaceId: request.workspaceId,
    });
    return {
      candidates: result.candidates.map((candidate) => ({
        assetOrder: request.brief.assetIds,
        body: candidate.body,
        conversionHook: candidate.conversionHook,
        title: candidate.title,
        topics: [
          `${request.store.city}美业`,
          request.store.project.name,
          request.brief.platform,
        ],
      })),
      evidence: {
        actualModel: result.evidence.actualCatalogModelId,
        exampleSetRevision: result.evidence.exampleSetRevision,
        promptRevision: result.evidence.promptRevision,
        templateRevision: promptRevision.templateRevision,
        providerCost: {
          amount: result.evidence.providerCost.amount,
          currency: result.evidence.providerCost.currency,
          status: result.evidence.providerCost.status,
        },
        requestedModel:
          result.evidence.requestedSelection.mode === 'fixed'
            ? (result.evidence.requestedSelection.catalogModelId ?? 'fixed')
            : 'auto',
        routeSnapshotId: result.evidence.routeSnapshot.id,
      },
    };
  }
}
