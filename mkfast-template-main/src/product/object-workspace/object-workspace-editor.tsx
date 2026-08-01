/**
 * Tiptap body editor for the object workspace only (P2-10 / #322 / C12).
 *
 * Plain-paragraph document: text offsets align with the stable-anchor model
 * used by selection rewrite (prefix/selected/suffix on the body string).
 * Must never mount in Composer.
 */

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

export type ObjectWorkspaceBodySelection = {
  start: number;
  end: number;
  text: string;
};

export type ObjectWorkspaceEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: ObjectWorkspaceBodySelection | null) => void;
  editable?: boolean;
  'data-testid'?: string;
};

function plainToDoc(text: string): string {
  // Single paragraph; empty body still needs a valid doc.
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<p>${escaped || '<br>'}</p>`;
}

function docToPlain(editorText: string): string {
  // Tiptap textBetween joins blocks with \n; body field is plain string.
  return editorText;
}

export function ObjectWorkspaceEditor(props: ObjectWorkspaceEditorProps) {
  const testId = props['data-testid'] ?? 'object-workspace-editor';
  const editor = useEditor({
    // Avoid SSR hydration mismatch under TanStack Start / Vitest.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Keep the surface copy-focused: no headings/lists in the body field.
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
    ],
    content: plainToDoc(props.value),
    editable: props.editable !== false,
    editorProps: {
      attributes: {
        class:
          'min-h-28 max-w-prose rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'data-testid': testId,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': '对象工作区正文',
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = docToPlain(current.getText());
      if (next !== props.value) {
        props.onChange(next);
      }
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      if (from === to) {
        props.onSelectionChange?.(null);
        return;
      }
      // Map PM positions to plain offsets for a single-paragraph doc:
      // text starts at position 1 inside the paragraph node.
      const start = Math.max(0, from - 1);
      const end = Math.max(start, to - 1);
      const text = current.state.doc.textBetween(from, to, '\n');
      props.onSelectionChange?.({ start, end, text });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getText();
    if (current === props.value) return;
    // External draft reset (new revision) — replace content without looping.
    editor.commands.setContent(plainToDoc(props.value), false);
  }, [editor, props.value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(props.editable !== false);
  }, [editor, props.editable]);

  return (
    <div
      className="object-workspace-tiptap"
      data-testid={`${testId}-host`}
      data-editor="tiptap"
    >
      <EditorContent editor={editor} />
    </div>
  );
}
