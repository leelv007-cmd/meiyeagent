import { projectMerchantArtifactStatus } from '@/product/merchant-vocabulary';

export function ArtifactStatusLabel({ status }: { status: string }) {
  return (
    <span
      className="text-muted bg-muted/50 rounded-full px-2 py-0.5 text-[10px] tracking-wide"
      data-testid="agent-artifact-status"
    >
      {projectMerchantArtifactStatus(status)}
    </span>
  );
}
