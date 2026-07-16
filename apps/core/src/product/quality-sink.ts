export interface ProductQualityEvent {
  id: string;
  contentId: string;
  outcome:
    | 'adopted_directly'
    | 'adopted_with_small_edit'
    | 'rerolled'
    | 'abandoned'
    | 'published';
  catalogModelId: string;
  promptRevision: string;
  templateRevision: string;
  exampleSetRevision: string;
  scenario: string;
  editDistance?: number;
  createdAt: string;
}

export interface ProductQualitySink {
  record(workspaceId: string, event: ProductQualityEvent): Promise<void>;
}

export const noOpProductQualitySink: ProductQualitySink = {
  async record() {},
};
