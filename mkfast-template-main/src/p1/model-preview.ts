import type { ModelModality } from '@/p1/settings-view-model';

const MODEL_PREVIEW_BY_MODALITY: Record<ModelModality, string> = {
  audio: '/seed/model/model-video-storyboard.webp',
  image: '/seed/model/model-image-beauty.webp',
  llm: '/seed/model/model-copy-planning.webp',
  video: '/seed/model/model-video-storyboard.webp',
};

export function modelPreviewUrl(modality: ModelModality) {
  return MODEL_PREVIEW_BY_MODALITY[modality];
}
