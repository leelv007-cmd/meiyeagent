import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
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

test('Skills admin route exposes define, accept, bind and rollback commands', () => {
  assert.equal(typeof skillsRoute.Route.options.component, 'function');
  const html = renderToStaticMarkup(<AdminSkillsControl />);

  assert.match(html, /data-testid="admin-skills-control"/);
  assert.match(html, /定义 Skill/);
  assert.match(html, /受理并冻结/);
  assert.match(html, /绑定 Workflow 阶段/);
  assert.match(html, /回滚绑定/);
});
