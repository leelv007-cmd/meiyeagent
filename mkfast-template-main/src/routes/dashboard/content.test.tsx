import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  clearContentPackageVariantSubmissionIdentity,
  ContentPackageVariantsStatus,
  createContentPackageVariantSubmissionIdentity,
  LegacyContentBody,
  writeTextToClipboard,
} = await import('./content');

type ActionElement = ReactElement<{
  children?: ReactNode;
  onClick?: () => void;
}>;

function visibleText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(visibleText).join('');
  if (!isValidElement(node)) return '';
  const element = node as ReactElement<{ children?: ReactNode }>;
  return Children.toArray(element.props.children).map(visibleText).join('');
}

function findAction(node: ReactNode, label: string): ActionElement | undefined {
  if (!isValidElement(node)) return undefined;
  const element = node as ActionElement;
  if (
    element.props.onClick &&
    visibleText(element.props.children).includes(label)
  ) {
    return element;
  }
  for (const child of Children.toArray(element.props.children)) {
    const match = findAction(child, label);
    if (match) return match;
  }
  return undefined;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test('shows the unified creating state while three-platform variants are pending', () => {
  const html = renderToStaticMarkup(<ContentPackageVariantsStatus pending />);

  assert.match(html, /三平台版本创作中…/u);
});

test('reuses one variant intent across response loss and refresh', () => {
  const storage = memoryStorage();
  const times = [
    new Date('2026-07-17T01:00:00.000Z'),
    new Date('2026-07-17T01:00:01.000Z'),
  ];
  const intentIds = ['intent-1', 'intent-2'];
  const nextSubmission = () =>
    createContentPackageVariantSubmissionIdentity('package-1', 'version-1', {
      createIntentId: () => intentIds.shift()!,
      now: () => times.shift()!,
      storage,
    });
  const initialSubmission = nextSubmission();
  let retrySubmission:
    | ReturnType<typeof createContentPackageVariantSubmissionIdentity>
    | undefined;
  const status = ContentPackageVariantsStatus({
    failed: true,
    onRetry: () => {
      retrySubmission = nextSubmission();
    },
    pending: false,
  });
  const html = renderToStaticMarkup(status);

  assert.match(html, /三平台版本生成未完成，需处理/u);
  assert.match(html, /重试生成/u);
  const retry = findAction(status, '重试生成');
  assert.ok(retry?.props.onClick);
  retry.props.onClick();
  assert.equal(retrySubmission?.submissionKey, initialSubmission.submissionKey);
  assert.equal(
    retrySubmission?.quoteAcceptedAt,
    initialSubmission.quoteAcceptedAt
  );
});

test('rotates the variant intent only after success or an input version change', () => {
  const storage = memoryStorage();
  const intentIds = ['intent-1', 'intent-2', 'intent-3'];
  const options = {
    createIntentId: () => intentIds.shift()!,
    now: () => new Date('2026-07-17T01:00:00.000Z'),
    storage,
  };
  const first = createContentPackageVariantSubmissionIdentity(
    'package-1',
    'version-1',
    options
  );
  const changedInput = createContentPackageVariantSubmissionIdentity(
    'package-1',
    'version-2',
    options
  );

  assert.notEqual(changedInput.submissionKey, first.submissionKey);

  clearContentPackageVariantSubmissionIdentity(
    'package-1',
    'version-2',
    storage
  );
  const afterSuccess = createContentPackageVariantSubmissionIdentity(
    'package-1',
    'version-2',
    options
  );

  assert.notEqual(afterSuccess.submissionKey, changedInput.submissionKey);
});

test('expands and collapses the full body of read-only legacy content', () => {
  const body = '第一段。\n第二段。\n第三段。\n第四段仍然必须可见。';
  let expanded = false;
  const renderBody = () =>
    LegacyContentBody({
      body,
      expanded,
      onToggle: () => {
        expanded = !expanded;
      },
    });

  const collapsed = renderBody();
  const collapsedHtml = renderToStaticMarkup(collapsed);
  assert.match(collapsedHtml, /line-clamp-3/u);
  assert.match(collapsedHtml, /查看全文/u);

  const expand = findAction(collapsed, '查看全文');
  assert.ok(expand?.props.onClick);
  expand.props.onClick();

  const fullHtml = renderToStaticMarkup(renderBody());
  assert.doesNotMatch(fullHtml, /line-clamp-3/u);
  assert.match(fullHtml, /第四段仍然必须可见。/u);
  assert.match(fullHtml, /收起全文/u);
});

test('copies the complete legacy body through the clipboard boundary', () => {
  const body = '折叠时只显示三行。\n这是必须复制的第四行。';
  const writes: string[] = [];
  const clipboard = {
    async writeText(text: string) {
      writes.push(text);
    },
  };
  const legacyBody = LegacyContentBody({
    body,
    expanded: false,
    onCopy: (text) => writeTextToClipboard(text, clipboard),
    onToggle: () => undefined,
  });
  const html = renderToStaticMarkup(legacyBody);

  assert.match(html, /复制全文/u);
  const copy = findAction(legacyBody, '复制全文');
  assert.ok(copy?.props.onClick);
  copy.props.onClick();
  assert.deepEqual(writes, [body]);
});
