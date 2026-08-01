export {
  ObjectWorkspaceEditor,
  type ObjectWorkspaceBodySelection,
  type ObjectWorkspaceEditorProps,
} from './object-workspace-editor';

export {
  ObjectWorkspaceShell,
  objectWorkspaceCarrierFromFacts,
  type ObjectWorkspaceCarrier,
  type ObjectWorkspaceShellProps,
} from './object-workspace-shell';

export {
  NoteObjectWorkspace,
  type NoteObjectWorkspaceProps,
} from './note-object-workspace';

export {
  NoteWorkspacePreviews,
  type NoteWorkspacePreviewCover,
  type NoteWorkspacePreviewDocument,
  type NoteWorkspacePreviewsProps,
} from './note-workspace-previews';

export {
  SELECTION_AI_ACTIONS,
  SELECTION_AI_LABELS,
  SELECTION_AI_LOCAL_TEMPLATES,
  buildSelectionAiPrompt,
  selectionAiNeedsInstruction,
  selectionAiToolbarItems,
  type SelectionAiAction,
} from './selection-ai-model';

export {
  SelectionAiToolbar,
  type SelectionAiToolbarProps,
} from './selection-ai-toolbar';
