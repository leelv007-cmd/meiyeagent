/**
 * Tiptap body editor for the object workspace only (P2-10 / #322 / C12).
 *
 * Plain-paragraph document: text offsets align with the stable-anchor model
 * used by selection rewrite (prefix/selected/suffix on the body string).
 * Must never mount in Composer.
 */

import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { SensitiveWordHit } from '@meiye/contracts';
import { forwardRef, useEffect, useImperativeHandle } from 'react';

import { canReplaceSensitiveHit } from './sensitive-inline-check-model';

export type ObjectWorkspaceBodySelection = {
  start: number;
  end: number;
  text: string;
};

export type ObjectWorkspaceEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: ObjectWorkspaceBodySelection | null) => void;
  sensitiveHits?: readonly SensitiveWordHit[];
  onSensitiveReplacementApplied?: () => void;
  editable?: boolean;
  'data-testid'?: string;
};

export type ObjectWorkspaceSensitiveReplacement = {
  requestText: string;
  hit: SensitiveWordHit;
  replacement: string;
};

export type ObjectWorkspaceEditorHandle = {
  replaceSensitiveHit: (
    request: ObjectWorkspaceSensitiveReplacement
  ) => boolean;
};

const sensitiveDecorationsKey = new PluginKey<DecorationSet>(
  'object-workspace-sensitive-decorations'
);

const OBJECT_WORKSPACE_BLOCK_SEPARATOR = '\n\n';

type PlainTextPositionSegment = {
  plainEnd: number;
  plainStart: number;
  pmStart: number;
  text: string;
};

function objectWorkspacePlainTextMap(doc: ProseMirrorNode) {
  const segments: PlainTextPositionSegment[] = [];
  let plainText = '';

  const append = (text: string, pmStart: number) => {
    const plainStart = plainText.length;
    plainText += text;
    segments.push({
      plainStart,
      plainEnd: plainText.length,
      pmStart,
      text,
    });
  };

  doc.nodesBetween(0, doc.content.size, (node, position) => {
    if (node.isBlock && position > 0) {
      // ProseMirror has two positions between sibling paragraphs. Tiptap's
      // getText serializes those positions as the two-code-unit separator.
      append(OBJECT_WORKSPACE_BLOCK_SEPARATOR, position - 1);
    }
    if (node.isText && node.text) {
      append(node.text, position);
      return;
    }
    if (node.type.name === 'hardBreak') {
      append('\n', position);
      return false;
    }
  });

  return { docSize: doc.content.size, plainText, segments };
}

function plainBoundaryToProseMirror(
  map: ReturnType<typeof objectWorkspacePlainTextMap>,
  offset: number,
  side: 'end' | 'start'
): number | null {
  const ordered = side === 'start' ? map.segments : [...map.segments].reverse();
  for (const segment of ordered) {
    const belongs =
      side === 'start'
        ? offset >= segment.plainStart && offset < segment.plainEnd
        : offset > segment.plainStart && offset <= segment.plainEnd;
    if (belongs) {
      return segment.pmStart + offset - segment.plainStart;
    }
  }
  if (offset === 0 && map.plainText.length === 0) return 1;
  if (offset === map.plainText.length) {
    const last = map.segments.at(-1);
    return last ? last.pmStart + last.text.length : 1;
  }
  return null;
}

function plainTextRangeToProseMirror(
  doc: ProseMirrorNode,
  start: number,
  end: number
) {
  const map = objectWorkspacePlainTextMap(doc);
  const from = plainBoundaryToProseMirror(map, start, 'start');
  const to = plainBoundaryToProseMirror(map, end, 'end');
  if (from === null || to === null || to <= from) return null;
  if (!doc.resolve(from).sameParent(doc.resolve(to))) return null;
  return { from, map, to };
}

function proseMirrorBoundaryToPlain(
  map: ReturnType<typeof objectWorkspacePlainTextMap>,
  position: number,
  side: 'end' | 'start'
): number | null {
  if (position === 0) return 0;
  if (position === map.docSize) return map.plainText.length;
  const ordered = side === 'start' ? map.segments : [...map.segments].reverse();
  for (const segment of ordered) {
    const pmEnd = segment.pmStart + segment.text.length;
    const belongs =
      side === 'start'
        ? position >= segment.pmStart && position < pmEnd
        : position > segment.pmStart && position <= pmEnd;
    if (belongs) {
      return segment.plainStart + position - segment.pmStart;
    }
  }
  if (position === 1 && map.plainText.length === 0) return 0;
  const last = map.segments.at(-1);
  if (last && position === last.pmStart + last.text.length) {
    return map.plainText.length;
  }
  return null;
}

function proseMirrorRangeToPlainText(
  doc: ProseMirrorNode,
  from: number,
  to: number
) {
  const map = objectWorkspacePlainTextMap(doc);
  const start = proseMirrorBoundaryToPlain(map, from, 'start');
  const end = proseMirrorBoundaryToPlain(map, to, 'end');
  if (start === null || end === null || end <= start) return null;
  return {
    start,
    end,
    text: map.plainText.slice(start, end),
  };
}

function createSensitiveDecorations(
  doc: ProseMirrorNode,
  hits: readonly SensitiveWordHit[]
) {
  const decorations = hits.flatMap((hit) => {
    const range = plainTextRangeToProseMirror(
      doc,
      hit.index,
      hit.index + hit.length
    );
    if (!range) return [];
    if (
      range.map.plainText.slice(hit.index, hit.index + hit.length) !== hit.word
    ) {
      return [];
    }
    return [
      Decoration.inline(range.from, range.to, {
        class:
          'sensitive-word-highlight rounded-sm bg-destructive/15 underline decoration-destructive',
        'data-sensitive-word': hit.word,
        'data-sensitive-word-id': hit.wordId,
      }),
    ];
  });
  return DecorationSet.create(doc, decorations);
}

const SensitiveDecorations = Extension.create({
  name: 'sensitiveDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: sensitiveDecorationsKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, decorations) => {
            const replacement = transaction.getMeta(sensitiveDecorationsKey) as
              | readonly SensitiveWordHit[]
              | undefined;
            if (replacement !== undefined) {
              return createSensitiveDecorations(transaction.doc, replacement);
            }
            return decorations.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations: (state) =>
            sensitiveDecorationsKey.getState(state) ?? DecorationSet.empty,
        },
      }),
    ];
  },
});

function plainToDoc(text: string): string {
  const escapeInline = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  return text
    .split(OBJECT_WORKSPACE_BLOCK_SEPARATOR)
    .map((paragraph) => `<p>${escapeInline(paragraph) || '<br>'}</p>`)
    .join('');
}

function docToPlain(editorText: string): string {
  // Tiptap textBetween joins blocks with \n; body field is plain string.
  return editorText;
}

export const ObjectWorkspaceEditor = forwardRef<
  ObjectWorkspaceEditorHandle,
  ObjectWorkspaceEditorProps
>(function ObjectWorkspaceEditor(props, ref) {
  const testId = props['data-testid'] ?? 'object-workspace-editor';
  const editor = useEditor({
    // Avoid SSR hydration mismatch under TanStack Start / Vitest.
    immediatelyRender: false,
    extensions: [
      SensitiveDecorations,
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
      const next = docToPlain(
        current.getText({ blockSeparator: OBJECT_WORKSPACE_BLOCK_SEPARATOR })
      );
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
      const selection = proseMirrorRangeToPlainText(
        current.state.doc,
        from,
        to
      );
      props.onSelectionChange?.(selection);
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

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(
        sensitiveDecorationsKey,
        props.sensitiveHits ?? []
      )
    );
  }, [editor, props.sensitiveHits]);

  useImperativeHandle(
    ref,
    () => ({
      replaceSensitiveHit: (request) => {
        if (!editor) return false;
        const currentText = editor.getText({
          blockSeparator: OBJECT_WORKSPACE_BLOCK_SEPARATOR,
        });
        if (
          !canReplaceSensitiveHit({
            currentText,
            requestText: request.requestText,
            hit: request.hit,
            replacement: request.replacement,
          })
        ) {
          return false;
        }
        const range = plainTextRangeToProseMirror(
          editor.state.doc,
          request.hit.index,
          request.hit.index + request.hit.length
        );
        if (!range || range.map.plainText !== currentText) return false;
        editor.view.dispatch(
          editor.state.tr.insertText(request.replacement, range.from, range.to)
        );
        props.onSensitiveReplacementApplied?.();
        return true;
      },
    }),
    [editor, props.onSensitiveReplacementApplied]
  );

  return (
    <div
      className="object-workspace-tiptap"
      data-testid={`${testId}-host`}
      data-editor="tiptap"
    >
      <EditorContent editor={editor} />
    </div>
  );
});
