import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PROMOTIONAL_MATERIAL_SPECS,
  quickEditExportUseDeliverySchema,
} from '@meiye/contracts';

import {
  ContentPackageExportCarrier,
  openLightComposerCarrier,
  parseLightComposerCarrier,
} from './content-package-export-carrier';

type ActionElement = ReactElement<{
  children?: ReactNode;
  onClick?: () => Promise<void> | void;
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

test('formatted text carrier copies and downloads the exact delivery text', async () => {
  const copied: string[] = [];
  const downloads: Array<{ fileName: string; text: string }> = [];
  const carrier = ContentPackageExportCarrier({
    clipboard: {
      async writeText(text: string) {
        copied.push(text);
      },
    },
    delivery: {
      contentType: 'text/plain;charset=utf-8',
      exportUse: 'wechat_moments',
      fileName: '朋友圈-染发文案.txt',
      kind: 'formatted_text',
      text: '夏日显白发色\n低损伤染发\n私信预约',
    },
    download: (text, fileName) => {
      downloads.push({ fileName, text });
    },
  });
  const html = renderToStaticMarkup(carrier);

  assert.match(html, /复制朋友圈文案/u);
  assert.match(html, /下载朋友圈文案/u);
  await findAction(carrier, '复制朋友圈文案')!.props.onClick!();
  await findAction(carrier, '下载朋友圈文案')!.props.onClick!();

  assert.deepEqual(copied, ['夏日显白发色\n低损伤染发\n私信预约']);
  assert.deepEqual(downloads, [
    {
      fileName: '朋友圈-染发文案.txt',
      text: '夏日显白发色\n低损伤染发\n私信预约',
    },
  ]);
});

test('light composer carrier asks the server to seed the exact package version', async () => {
  const materialSpecs = [
    {
      aspectRatio: '210:297',
      cropStrategy: 'contain_brand_safe' as const,
      format: 'image/png' as const,
      height: 3508,
      purpose: 'offline_a4_poster' as const,
      renderer: 'light-composer' as const,
      rendererVersion: 'light-composer-v1',
      textSafeArea: { bottom: 176, left: 176, right: 176, top: 176 },
      width: 2480,
    },
  ];
  const delivery = {
    exportUse: 'offline_material' as const,
    kind: 'light_composer' as const,
    materialSpecs,
    receiptCommand: 'export_work' as const,
    sourcePackageId: 'package-41',
    sourceWorkId: 'source-work-41',
    sourceVersionId: 'package-41-v3',
    templateRole: 'offline_material' as const,
  };
  const commands: Array<{
    action: string;
    payload: Record<string, unknown>;
  }> = [];
  const navigations: string[] = [];
  const carrier = ContentPackageExportCarrier({
    createWork: async (action, payload) => {
      commands.push({ action, payload });
      return { id: 'material-work-1' };
    },
    delivery,
    navigate: (href) => {
      navigations.push(href);
    },
  });
  const html = renderToStaticMarkup(carrier);

  assert.match(html, /去做门店海报/u);
  assert.doesNotMatch(html, /offline_material|light_composer|export_work/u);
  await findAction(carrier, '去做门店海报')!.props.onClick!();

  assert.deepEqual(commands, [
    {
      action: 'create_work_from_content_package',
      payload: {
        height: 3508,
        sourcePackageId: 'package-41',
        sourceVersionId: 'package-41-v3',
        width: 2480,
      },
    },
  ]);
  assert.equal(navigations.length, 1);
  const navigation = new URL(navigations[0]!, 'https://example.test');
  assert.equal(
    navigation.pathname.endsWith('/dashboard/works/material-work-1'),
    true
  );
  assert.deepEqual(
    parseLightComposerCarrier(navigation.searchParams.get('exportCarrier')),
    delivery
  );
  assert.deepEqual(parseLightComposerCarrier(delivery), delivery);
});

test('historical light composer carrier asks for regeneration without creating a blank work', async () => {
  const delivery = quickEditExportUseDeliverySchema.parse({
    exportUse: 'poster',
    kind: 'light_composer',
    materialSpecs: [
      PROMOTIONAL_MATERIAL_SPECS.find(
        (spec) => spec.purpose === 'wechat_moments_poster'
      )!,
    ],
    receiptCommand: 'export_work',
    sourceWorkId: 'historical-work-1',
    templateRole: 'poster',
  });
  if (delivery.kind !== 'light_composer') {
    assert.fail('Expected a historical Light Composer delivery.');
  }
  const carrier = ContentPackageExportCarrier({ delivery });
  const html = renderToStaticMarkup(carrier);

  assert.match(html, /历史版本缺少可核验来源/u);
  assert.match(html, /重新生成/u);
  assert.doesNotMatch(html, /去做宣传海报/u);

  const commands: string[] = [];
  await assert.rejects(
    openLightComposerCarrier(delivery, async (action) => {
      commands.push(action);
      return { id: 'must-not-exist' };
    }),
    /trusted package lineage/u
  );
  assert.deepEqual(commands, []);
});
