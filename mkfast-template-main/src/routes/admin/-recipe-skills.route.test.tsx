import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const recipeRoute = await import('./recipe-studio');
const skillsRoute = await import('./skills');
const { AdminRecipeStudioControl } = await import(
  '@/p1/admin-recipe-studio-control'
);
const { AdminSkillsControl } = await import('@/p1/admin-skills-control');
const { p1QueryKeys } = await import('@/p1/query-keys');

/** Renders the control with a seeded catalog so the table has rows to show. */
function renderSkillsControl(rows: Record<string, unknown>[] = []) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    p1QueryKeys.request('skills', 'skill_catalog_list', { tier: '' }),
    rows
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AdminSkillsControl />
    </QueryClientProvider>
  );
}

test('Recipe Studio admin route exposes the complete four-gate production chain', () => {
  assert.equal(typeof recipeRoute.Route.options.component, 'function');
  const html = renderToStaticMarkup(<AdminRecipeStudioControl />);

  assert.match(html, /data-testid="recipe-studio-control"/);
  assert.match(html, /1\. 编译/);
  assert.match(html, /2\. 校验/);
  assert.match(html, /3\. 记录评测/);
  assert.match(html, /4\. 内测试跑/);
  assert.match(html, /切换 production/);
  assert.match(html, /回滚 production/);
});

test('Skills admin route dispatches all five lifecycle commands', () => {
  assert.equal(typeof skillsRoute.Route.options.component, 'function');
  const html = renderSkillsControl();

  assert.match(html, /data-testid="admin-skills-control"/);
  for (const label of [
    '新建做法',
    '受理并冻结',
    '绑定阶段',
    '回滚绑定',
    '登记部署',
  ]) {
    assert.ok(html.includes(label), `missing lifecycle command: ${label}`);
  }
});

test('Skills catalog renders the source column and its description', () => {
  const html = renderSkillsControl([
    {
      skillId: 'skill.beauty-story',
      name: '美业故事结构',
      description: '为美业内容提供已受理的故事结构。',
      sourceKind: 'induced',
      tier: 'industry',
      presentationPolicy: 'explainable',
      activeRevisionRef: 'skill.beauty-story@1',
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
    {
      skillId: 'skill.public-hook',
      name: '公开钩子范式',
      description: '从公开范本转译而来的开头钩子。',
      sourceKind: 'harvested',
      tier: 'industry',
      presentationPolicy: 'explainable',
      activeRevisionRef: null,
      updatedAt: '2026-07-29T00:00:00.000Z',
    },
  ]);

  assert.ok(html.includes('归纳'), 'induced source label missing');
  assert.ok(html.includes('收割转译'), 'harvested source label missing');
  assert.ok(html.includes('行业层'), 'tier label missing');
  assert.ok(
    html.includes('为美业内容提供已受理的故事结构。'),
    'description is a required catalog column'
  );
  // One of two industry entries is induced, so the corroboration ratio the
  // moat metric depends on has to be computable straight off this column.
  assert.ok(html.includes('50%'), 'corroboration ratio missing');
});
