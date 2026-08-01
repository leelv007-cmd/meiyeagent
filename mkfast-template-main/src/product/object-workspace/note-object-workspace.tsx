import {
  ObjectWorkspaceShell,
  type ObjectWorkspaceShellProps,
} from './object-workspace-shell';

export type NoteObjectWorkspaceProps = ObjectWorkspaceShellProps;

/** One object workspace for an image-text note: media and document stay together. */
export function NoteObjectWorkspace(props: NoteObjectWorkspaceProps) {
  const { children, ...shellProps } = props;
  return (
    <div data-testid="result-image-text-workspace">
      <ObjectWorkspaceShell {...shellProps} carrier="note">
        <div className="space-y-6" data-testid="note-object-workspace">
          {children}
        </div>
      </ObjectWorkspaceShell>
    </div>
  );
}
