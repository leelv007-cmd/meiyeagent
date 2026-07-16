export interface LightComposerComplianceInput {
  aigcLabelEnabled: boolean;
  watermarkEnabled: boolean;
  watermarkText?: string;
}

export interface LightComposerComplianceLabel {
  kind: 'aigc' | 'watermark';
  text: string;
}

export function buildLightComposerComplianceLabels(
  input: LightComposerComplianceInput,
  copy: { aigc: string; watermark: string }
): LightComposerComplianceLabel[] {
  const labels: LightComposerComplianceLabel[] = [];
  if (input.aigcLabelEnabled) {
    labels.push({ kind: 'aigc', text: copy.aigc });
  }
  if (input.watermarkEnabled) {
    labels.push({
      kind: 'watermark',
      text: input.watermarkText?.trim() || copy.watermark,
    });
  }
  return labels;
}
