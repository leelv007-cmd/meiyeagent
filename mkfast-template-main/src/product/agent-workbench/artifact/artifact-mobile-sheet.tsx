/**
 * Mobile fullscreen Artifact sheet (V3.1 §4.3 / V31-15).
 * Lightweight panel — avoids Sheet/paraglide coupling for unit tests.
 */

import { cn } from '@/lib/utils';

import type { ArtifactProjection } from '../agent-event-reducer';
import { ArtifactCanvas } from './artifact-canvas';

export type ArtifactMobileSheetProps = {
  open: boolean;
  artifacts: readonly ArtifactProjection[];
  onClose?: () => void;
  onViewRevision?: (artifactId: string, revision: number | null) => void;
  /** Optional host slot under the canvas (legacy works body). */
  children?: React.ReactNode;
  className?: string;
  showEmpty?: boolean;
};

export function ArtifactMobileSheet({
  open,
  artifacts,
  onClose,
  onViewRevision,
  children,
  className,
  showEmpty = true,
}: ArtifactMobileSheetProps) {
  if (!open) return null;

  return (
    <div
      aria-modal="true"
      className={cn(
        'bg-background fixed inset-0 z-50 flex flex-col',
        className
      )}
      data-testid="agent-artifact-mobile-sheet"
      role="dialog"
    >
      <header className="border-border/50 flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-medium">作品</h2>
        <button
          className="text-muted hover:text-foreground rounded-md px-2 py-1 text-xs"
          data-testid="agent-artifact-mobile-sheet-close"
          onClick={() => onClose?.()}
          type="button"
        >
          关闭
        </button>
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-4"
        data-testid="agent-workstream-works"
      >
        <ArtifactCanvas
          artifacts={artifacts}
          onViewRevision={onViewRevision}
          showEmpty={showEmpty}
          viewport="mobile"
        />
        {children}
      </div>
    </div>
  );
}
