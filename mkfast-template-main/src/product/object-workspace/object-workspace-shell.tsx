/**
 * Object workspace shell (P2-10 / #322).
 *
 * Shared refinement surface for copy / note / image_text carriers.
 * Hosts Tiptap body editing + selection AI six actions.
 * Phone-shell preview and waterfall cover belong to later tickets (#326).
 */

import type { ReactNode } from 'react';

export type ObjectWorkspaceCarrier = 'copy' | 'note' | 'media';

export type ObjectWorkspaceShellProps = {
  carrier: ObjectWorkspaceCarrier;
  title?: string;
  workId?: string;
  children: ReactNode;
  /** Optional trailing tools (export etc.) — not selection AI. */
  tools?: ReactNode;
};

const CARRIER_LABELS: Record<ObjectWorkspaceCarrier, string> = {
  copy: '文案',
  note: '笔记',
  media: '图文 / 媒体',
};

export function ObjectWorkspaceShell(props: ObjectWorkspaceShellProps) {
  return (
    <div
      className="space-y-4"
      data-testid="object-workspace-shell"
      data-object-workspace="true"
      data-carrier={props.carrier}
      data-work-id={props.workId}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-2"
        data-testid="object-workspace-shell-header"
      >
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">对象工作区</p>
          <h2 className="text-base font-medium">
            {props.title?.trim() || '成品精修'}
          </h2>
        </div>
        <span
          className="rounded-full border px-2.5 py-0.5 text-xs"
          data-testid="object-workspace-carrier"
        >
          {CARRIER_LABELS[props.carrier]}
        </span>
      </header>
      {props.tools ? (
        <div
          className="flex flex-wrap gap-2"
          data-testid="object-workspace-tools"
        >
          {props.tools}
        </div>
      ) : null}
      <div data-testid="object-workspace-body">{props.children}</div>
    </div>
  );
}

/**
 * Derive the shell carrier from ContentPackage product vocabulary.
 * Wire kind image_text + assets → note; empty assets → copy; video → media.
 */
export function objectWorkspaceCarrierFromFacts(input: {
  orderedAssetCount?: number;
  workspaceKind?: 'copy' | 'image' | 'video';
}): ObjectWorkspaceCarrier {
  if (input.workspaceKind === 'video') return 'media';
  if (input.workspaceKind === 'image') {
    return (input.orderedAssetCount ?? 0) > 0 ? 'note' : 'media';
  }
  return (input.orderedAssetCount ?? 0) > 0 ? 'note' : 'copy';
}
