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

const { LegacyContentBody, writeTextToClipboard } = await import('./content');

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
