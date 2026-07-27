import type { ComponentProps } from 'react';
import {
  filterRichTextEditorSuggestionItems,
  RichTextEditorActionButton,
  RichTextEditorBubbleMenu,
  RichTextEditorCharacterCount,
  RichTextEditorCommandButton,
  RichTextEditorContent,
  RichTextEditorFloatingMenu,
  RichTextEditorFooter,
  RichTextEditorLinkPopover,
  RichTextEditorRoot,
  RichTextEditorShell,
  RichTextEditorSuggestionMenu,
  RichTextEditorToggleButton,
  RichTextEditorToolbar,
  RichTextEditorToolbarGroup,
  RichTextEditorToolbarSeparator,
  useRichTextEditor,
  useRichTextEditorState,
} from './rich-text-editor';

export const RichTextEditor = Object.assign(RichTextEditorRoot, {
  ActionButton: RichTextEditorActionButton,
  BubbleMenu: RichTextEditorBubbleMenu,
  CharacterCount: RichTextEditorCharacterCount,
  CommandButton: RichTextEditorCommandButton,
  Content: RichTextEditorContent,
  FloatingMenu: RichTextEditorFloatingMenu,
  Footer: RichTextEditorFooter,
  LinkPopover: RichTextEditorLinkPopover,
  Root: RichTextEditorRoot,
  Shell: RichTextEditorShell,
  SuggestionMenu: RichTextEditorSuggestionMenu,
  ToggleButton: RichTextEditorToggleButton,
  Toolbar: RichTextEditorToolbar,
  ToolbarGroup: RichTextEditorToolbarGroup,
  ToolbarSeparator: RichTextEditorToolbarSeparator,
});

export type RichTextEditor = {
  ActionButtonProps: ComponentProps<typeof RichTextEditorActionButton>;
  BubbleMenuProps: ComponentProps<typeof RichTextEditorBubbleMenu>;
  CharacterCountProps: ComponentProps<typeof RichTextEditorCharacterCount>;
  CommandButtonProps: ComponentProps<typeof RichTextEditorCommandButton>;
  ContentProps: ComponentProps<typeof RichTextEditorContent>;
  FloatingMenuProps: ComponentProps<typeof RichTextEditorFloatingMenu>;
  FooterProps: ComponentProps<typeof RichTextEditorFooter>;
  LinkPopoverProps: ComponentProps<typeof RichTextEditorLinkPopover>;
  Props: ComponentProps<typeof RichTextEditorRoot>;
  RootProps: ComponentProps<typeof RichTextEditorRoot>;
  ShellProps: ComponentProps<typeof RichTextEditorShell>;
  SuggestionMenuProps: ComponentProps<typeof RichTextEditorSuggestionMenu>;
  ToggleButtonProps: ComponentProps<typeof RichTextEditorToggleButton>;
  ToolbarGroupProps: ComponentProps<typeof RichTextEditorToolbarGroup>;
  ToolbarProps: ComponentProps<typeof RichTextEditorToolbar>;
  ToolbarSeparatorProps: ComponentProps<typeof RichTextEditorToolbarSeparator>;
};

export {
  filterRichTextEditorSuggestionItems,
  RichTextEditorActionButton,
  RichTextEditorBubbleMenu,
  RichTextEditorCharacterCount,
  RichTextEditorCommandButton,
  RichTextEditorContent,
  RichTextEditorFloatingMenu,
  RichTextEditorFooter,
  RichTextEditorLinkPopover,
  RichTextEditorRoot,
  RichTextEditorShell,
  RichTextEditorSuggestionMenu,
  RichTextEditorToggleButton,
  RichTextEditorToolbar,
  RichTextEditorToolbarGroup,
  RichTextEditorToolbarSeparator,
  useRichTextEditor,
  useRichTextEditorState,
};

export type {
  RichTextEditorActionButtonProps,
  RichTextEditorActionCommand,
  RichTextEditorBubbleMenuProps,
  RichTextEditorCharacterCountProps,
  RichTextEditorCommandButtonProps,
  RichTextEditorCommandState,
  RichTextEditorContentProps,
  RichTextEditorFloatingMenuProps,
  RichTextEditorFooterProps,
  RichTextEditorFormatCommand,
  RichTextEditorInstance,
  RichTextEditorLinkPopoverActionsProps,
  RichTextEditorLinkPopoverApplyButtonProps,
  RichTextEditorLinkPopoverContentProps,
  RichTextEditorLinkPopoverInputProps,
  RichTextEditorLinkPopoverRootProps,
  RichTextEditorLinkPopoverTriggerProps,
  RichTextEditorLinkPopoverUnsetButtonProps,
  RichTextEditorRootProps as RichTextEditorProps,
  RichTextEditorRootProps,
  RichTextEditorShellProps,
  RichTextEditorSuggestionCommandProps,
  RichTextEditorSuggestionItem,
  RichTextEditorSuggestionItemsProps,
  RichTextEditorSuggestionMenuProps,
  RichTextEditorSuggestionMenuRenderProps,
  RichTextEditorToggleButtonProps,
  RichTextEditorToolbarGroupProps,
  RichTextEditorToolbarProps,
  RichTextEditorToolbarSeparatorProps,
  RichTextEditorValueChangeDetails,
} from './rich-text-editor';
export { richTextEditorVariants } from './rich-text-editor.styles';
