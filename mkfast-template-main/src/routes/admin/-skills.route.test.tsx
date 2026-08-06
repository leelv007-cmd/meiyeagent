/**
 * Skills admin route presentation contracts (#387).
 * Product-surface / navigation style: titles resolve via Paraglide, no
 * hardcoded Chinese at the route boundary.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  admin_skills_description,
  admin_skills_title,
} from '@/locale/paraglide/messages';
import { overwriteGetLocale } from '@/locale/paraglide/runtime';

const skillsRouteSource = readFileSync(
  resolve(process.cwd(), 'src/routes/admin/skills.tsx'),
  'utf8'
);

test('skills route title and description use Paraglide message keys', () => {
  assert.match(skillsRouteSource, /admin_skills_title\(\)/);
  assert.match(skillsRouteSource, /admin_skills_description\(\)/);
  assert.match(skillsRouteSource, /@\/locale\/paraglide\/messages/);
  // No hardcoded Chinese at the route boundary (product-surface style).
  assert.doesNotMatch(skillsRouteSource, /[\u3400-\u9fff]/);
});

test('skills title messages resolve in both locales', () => {
  overwriteGetLocale(() => 'zh');
  assert.equal(admin_skills_title(), 'Skills');
  assert.match(admin_skills_description(), /Skill/);

  overwriteGetLocale(() => 'en');
  assert.equal(admin_skills_title(), 'Skills');
  assert.match(admin_skills_description(), /Skill/);

  overwriteGetLocale(() => 'zh');
});
