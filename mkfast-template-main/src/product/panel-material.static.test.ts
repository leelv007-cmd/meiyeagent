/**
 * 面板材质合同 —— DESIGN.md §4「玻璃有边法则」的消费侧。
 *
 * 两条规则，两种失效方式，都只在浏览器里看得见，所以在源码上钉住：
 *
 * 1. `bg-muted/NN` 在商家壳里必然归零。`--muted` 映到 `--tint-hover`（明 4% / 暗
 *    6% 的**底色** token），Tailwind 的 alpha 修饰符再乘一次，`bg-muted/30` 解析
 *    成 1.2% 的白——没有实底、没有 backdrop，其上的字实际压在氛围图上。补问门
 *    实测 2.41–4.40:1（明）、2.76–6.54:1（暗），文字色是对的，缺的是底。
 * 2. 玻璃只给浮在氛围层上的悬浮件。表单输入控件属于实体内容区，套玻璃等于把
 *    输入的字交给底下那张图去决定可读性。
 *
 * 两条都不会抛错、不会让别的测试变红，只会让店主读不到字，因此这里逐个文件断言。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * 注释里要能写出被禁的写法（不然改这行的人不知道禁的是什么），所以先把块注释
 * 摘掉再断言 —— 断的是渲染出去的类名，不是文档。
 */
const read = (relative: string) =>
  readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//gu, '');

const ALPHA_ON_ALPHA = /bg-muted\/\d/u;

test('the two conversion gates sit on porcelain, not on an alpha token', () => {
  const factCard = read('./composer/progressive-fact-card.tsx');
  const wizard = read('./store-intake/store-intake-wizard.tsx');

  for (const source of [factCard, wizard]) {
    assert.doesNotMatch(source, ALPHA_ON_ALPHA);
    assert.match(source, /className="meiye-porcelain rounded-2xl p-4"/u);
  }
});

test('the works search field is porcelain, not glass', () => {
  const works = read('./works/works-list-page.tsx');

  // 同排的筛选段仍是 chips，件级玻璃是它的正确材质——只有包住 <input> 的那片不是。
  assert.doesNotMatch(works, /<label\s+className="meiye-glass-piece/u);
  assert.match(
    works,
    /<label\s+className="meiye-porcelain[^"]*"\s+htmlFor="works-search"/u
  );
});

test('no product panel paints itself with an alpha token twice', () => {
  for (const relative of [
    './today-recommendation-card.tsx',
    './light-composer-canvas.tsx',
  ]) {
    assert.doesNotMatch(read(relative), ALPHA_ON_ALPHA, relative);
  }
});
