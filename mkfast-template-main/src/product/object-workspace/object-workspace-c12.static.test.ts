/**
 * C12 / D-171: Tiptap is allowed only inside the object workspace — never in
 * Composer main input or the note-plan outline frame (P2-10 / #322).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

const TIPTAP_IMPORT = /@tiptap\//u;
const OBJECT_WORKSPACE_EDITOR =
  /ObjectWorkspaceEditor|object-workspace-editor/u;

test('Composer main surfaces never import Tiptap or the object-workspace editor', () => {
  // A missing entry must fail, not be skipped. The list previously carried
  // 'src/product/composer/composer-input.tsx', which no longer exists, and the
  // catch-continue below swallowed it silently — the fence could have decayed
  // to zero checked files and still passed. The intent surface it stood for now
  // lives in composer-conversation.tsx (COMPOSER_INTENT_INPUT_TESTID), which is
  // already listed, so dropping the dead path costs no coverage.
  const composerFiles = [
    'src/product/composer/composer-home.tsx',
    'src/product/composer/composer-conversation.tsx',
    'src/product/composer/note-plan-timeline-frame.tsx',
    'src/product/composer/workbench-shell-layout.tsx',
  ];
  for (const file of composerFiles) {
    const source = readSource(file);
    assert.doesNotMatch(
      source,
      TIPTAP_IMPORT,
      `${file} must not import @tiptap/*`
    );
    assert.doesNotMatch(
      source,
      OBJECT_WORKSPACE_EDITOR,
      `${file} must not mount ObjectWorkspaceEditor`
    );
  }
});

test('Workstream Artifact renderer never imports Tiptap or the object-workspace editor', () => {
  const artifactFiles = [
    'src/product/agent-workbench/artifact/artifact-canvas.tsx',
    'src/product/agent-workbench/artifact/copy-artifact.tsx',
    'src/product/agent-workbench/artifact/note-artifact.tsx',
    'src/product/agent-workbench/artifact/video-artifact.tsx',
    'src/product/agent-workbench/artifact/publish-artifact.tsx',
    'src/product/agent-workbench/artifact/image-artifact.tsx',
    'src/product/agent-workbench/artifact/artifact-media.tsx',
    'src/product/agent-workbench/artifact/artifact-carrier.ts',
  ];
  for (const file of artifactFiles) {
    const source = readSource(file);
    assert.doesNotMatch(
      source,
      TIPTAP_IMPORT,
      `${file} must not import @tiptap/*`
    );
    assert.doesNotMatch(
      source,
      OBJECT_WORKSPACE_EDITOR,
      `${file} must not mount ObjectWorkspaceEditor`
    );
    assert.doesNotMatch(
      source,
      /video-subtitle-panel|video-cover-panel|video-worksurface/u,
      `${file} must not host subtitle/cover/editor surfaces`
    );
  }
});

test('object workspace is the only product mount for Tiptap', () => {
  const editor = readSource(
    'src/product/object-workspace/object-workspace-editor.tsx'
  );
  assert.match(editor, TIPTAP_IMPORT);
  assert.match(editor, /useEditor/u);

  const worksurface = readSource(
    'src/product/results/copy-image-text-worksurface.tsx'
  );
  assert.match(worksurface, OBJECT_WORKSPACE_EDITOR);
  assert.match(worksurface, /ObjectWorkspaceShell/u);
  assert.match(worksurface, /SelectionAiToolbar/u);
  assert.match(worksurface, /buildSelectionAiPrompt/u);

  const shell = readSource(
    'src/product/object-workspace/object-workspace-shell.tsx'
  );
  assert.match(shell, /object-workspace-shell/u);
  assert.match(shell, /data-object-workspace/u);
});

test('Delivered card still gates into the object workspace (C7)', () => {
  const delivery = readSource(
    'src/product/composer/composer-delivery-card.tsx'
  );
  assert.match(delivery, /composer-delivery-object-workspace-gate/u);
  assert.match(delivery, /composer-delivery-action-object-workspace/u);
  assert.doesNotMatch(delivery, TIPTAP_IMPORT);
});
