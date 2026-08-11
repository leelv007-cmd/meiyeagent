/**
 * T36 — Landing phase one: the marketing page may only claim capability the
 * product actually projects today, and every link on it must resolve.
 *
 * The fact sources are the runtime capability modules, not a copy list:
 *   - delivery-capability-groups: which delivery actions/groups are visible
 *     (launchAutomaticVerifiedCount() === 0 → "直接发布" group hidden, D-086)
 *   - copy-image-text-worksurface-model: the locked platform carriers (D-023 /
 *     D-128 three variant platforms + moments as an export-only destination)
 *   - routeTree.gen.ts: which paths exist, so a CTA cannot point at a dead page
 *
 * Landing copy lives entirely in Paraglide messages, so the copy assertions run
 * over the landing_* key space rather than the component sources.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  COPY_PREVIEW_CARRIER_LABELS,
  COPY_PREVIEW_PLATFORM_CARRIERS,
} from '../../product/results/copy-image-text-worksurface-model';
import {
  DELIVERY_ACTION_LABEL,
  DELIVERY_GROUP_LABEL,
  launchAutomaticVerifiedCount,
  projectDeliveryCapabilityGroups,
  type DeliveryCapabilityFacts,
} from '../../product/results/delivery-capability-groups';
import { Routes } from '../../lib/routes';

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8');

const zh = JSON.parse(read('project.inlang/messages/zh.json')) as Record<
  string,
  string
>;
const en = JSON.parse(read('project.inlang/messages/en.json')) as Record<
  string,
  string
>;

const landingKeys = Object.keys(zh).filter((key) => key.startsWith('landing_'));
const landingZh = landingKeys.map((key) => zh[key]).join('\n');
const landingEn = landingKeys.map((key) => en[key]).join('\n');

/** Everything the delivery panel can actually do when nothing is missing. */
const FULLY_CAPABLE_FACTS: DeliveryCapabilityFacts = {
  target: 'xiaohongshu',
  hasCopyableText: true,
  hasSingleDownload: true,
  hasFullPackage: true,
  hasExternalSendApproval: true,
  hasNavigatorShare: true,
  canShareFiles: true,
  hasOneShotLink: true,
  automaticVerifiedPlatformCount: launchAutomaticVerifiedCount(),
};

test('landing copy claims no delivery group the launch gate keeps hidden', () => {
  const groups = projectDeliveryCapabilityGroups(FULLY_CAPABLE_FACTS);
  const hidden = groups.filter((group) => !group.visible).map((g) => g.id);

  // Preconditions: at launch the only hidden group is direct publish.
  assert.equal(launchAutomaticVerifiedCount(), 0);
  assert.deepEqual(hidden, ['direct_publish']);

  // The hidden group's label must not appear as a landing capability claim.
  assert.ok(landingKeys.length > 0);
  assert.doesNotMatch(
    landingZh,
    new RegExp(DELIVERY_GROUP_LABEL.direct_publish, 'u')
  );
  assert.doesNotMatch(
    landingZh,
    new RegExp(DELIVERY_ACTION_LABEL.automatic_verified, 'u')
  );
});

test('landing copy carries no publish-on-behalf claim in either language', () => {
  // publish:<platform> has never passed the capability gate, so no phrasing may
  // suggest the product posts to a merchant's account for them.
  for (const pattern of [
    /一键发[布出送]/u,
    /自动发布/u,
    /替你发[布出]/u,
    /帮你发[布出]/u,
    /代为?发布/u,
    /直发到/u,
  ]) {
    assert.doesNotMatch(landingZh, pattern, String(pattern));
  }
  for (const pattern of [
    /one[- ]tap publish/iu,
    /publish in one tap/iu,
    /auto-?publish/iu,
    /publish(?:es)? (?:it )?(?:for you|on your behalf)/iu,
    /posts? (?:it )?for you/iu,
  ]) {
    assert.doesNotMatch(landingEn, pattern, String(pattern));
  }
});

test('landing states delivery as the current situation, never as an absolute', () => {
  // launchAutomaticVerifiedCount() is a runtime value that can rise once a
  // platform passes verification; copy that says "never" would become a lie.
  assert.doesNotMatch(landingZh, /不支持自动发布|永远(?:都)?不|绝不代发/u);
  assert.doesNotMatch(landingEn, /never publish|will never post/iu);

  // The delivery sentences are time-scoped instead.
  const deliveryKeys = ['landing_steps_4_desc', 'landing_faq_a2'];
  for (const key of deliveryKeys) {
    assert.match(zh[key], /当前|目前/u, `zh ${key}`);
    assert.match(en[key], /today|for now/iu, `en ${key}`);
  }
});

test('landing names delivery actions only from the visible capability groups', () => {
  const visible = projectDeliveryCapabilityGroups(FULLY_CAPABLE_FACTS).filter(
    (group) => group.visible
  );
  const visibleActionLabels = visible.flatMap((group) =>
    group.actions.map((action) => DELIVERY_ACTION_LABEL[action.id])
  );

  // The landing's delivery vocabulary is drawn from real, visible actions.
  assert.ok(visibleActionLabels.includes(DELIVERY_ACTION_LABEL.assisted));
  assert.match(
    landingZh,
    new RegExp(DELIVERY_ACTION_LABEL.assisted, 'u'),
    'assisted handoff must be named with the product label'
  );
  assert.match(landingZh, /完整发布包/u);
  assert.match(landingZh, /导出/u);
  assert.match(landingZh, /复制/u);
});

test('landing names all four output kinds the compilers produce', () => {
  // D-118: copy / image / image_text_note / video are the four output kinds.
  for (const label of ['文案', '图片', '图文笔记', '视频']) {
    assert.match(landingZh, new RegExp(label, 'u'), label);
  }
  for (const label of ['copy', 'image', 'note', 'video']) {
    assert.match(landingEn, new RegExp(label, 'iu'), label);
  }
});

test('landing platform claims stay inside the locked carrier set', () => {
  // D-128: three variant platforms; moments is an export-only destination.
  for (const carrier of COPY_PREVIEW_PLATFORM_CARRIERS) {
    assert.match(
      landingZh,
      new RegExp(COPY_PREVIEW_CARRIER_LABELS[carrier], 'u'),
      carrier
    );
  }

  // Moments is never presented as a variant platform — it appears only in the
  // company of an export verb.
  const momentsStrings = landingKeys
    .map((key) => zh[key])
    .filter((value) => value.includes('朋友圈'));
  assert.ok(momentsStrings.length > 0);
  for (const value of momentsStrings) {
    assert.match(value, /导出/u, value);
  }

  // No platform outside the locked set is claimed.
  assert.doesNotMatch(landingZh, /微博|快手|知乎|哔哩哔哩|B 站|淘宝|美团/u);
});

test('landing activation copy matches the pilot registration chain', () => {
  // D-128 / T25: pilot access is email sign-up plus a redemption code.
  assert.match(landingZh, /兑换码/u);
  assert.match(landingEn, /redemption code/iu);
  // Until T25 lands the entry keeps pointing at the existing register route.
  assert.equal(Routes.Register, '/auth/register');
});

const LANDING_DIR = 'src/components/landing';

test('landing uses native reduced-motion-aware scrolling and Tabler icons', () => {
  const page = read(`${LANDING_DIR}/landing-page.tsx`);
  const styles = read(`${LANDING_DIR}/landing.css`);
  const sources = readdirSync(LANDING_DIR)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => read(`${LANDING_DIR}/${file}`))
    .join('\n');

  assert.doesNotMatch(page, /SmoothScroll/u);
  assert.doesNotMatch(sources, /from 'lucide-react'/u);
  assert.match(styles, /scroll-behavior: smooth/u);
  assert.match(styles, /scroll-padding-top: 100px/u);
  assert.match(
    styles,
    /prefers-reduced-motion: reduce[\s\S]*scroll-behavior: auto/u
  );
});

function landingSectionIds(): Set<string> {
  const page = read(`${LANDING_DIR}/landing-page.tsx`);
  const mounted = Array.from(
    page.matchAll(/from '@\/components\/landing\/([a-z-]+)'/g),
    (match) => match[1]
  );
  assert.ok(mounted.length > 0);
  const ids = new Set<string>();
  for (const module of [...mounted, 'landing-page']) {
    const source = read(`${LANDING_DIR}/${module}.tsx`);
    for (const match of source.matchAll(/\sid="([a-z0-9-]+)"/g)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function existingRoutePaths(): Set<string> {
  const tree = read('src/routeTree.gen.ts');
  const block = tree.match(
    /export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/
  );
  assert.ok(block, 'FileRoutesByFullPath block not found');
  const paths = Array.from(
    block[1].matchAll(/^\s*'([^']+)':/gm),
    (match) => match[1]
  );
  assert.ok(paths.includes('/'), 'route tree parse produced no root');
  return new Set(paths);
}

test('every landing link resolves to a live section or a live route', async () => {
  // The mounted set is every landing component that renders an anchor. Keep it
  // in step with landing-page.tsx: a component that grows a link but is absent
  // here would ship an unchecked — possibly dead — href.
  const [{ Header }, { Footer }, { Pricing }, { FAQ }, { HowItWorks }] =
    await Promise.all([
      import('./header'),
      import('./footer'),
      import('./pricing'),
      import('./faq'),
      import('./how-it-works'),
    ]);

  const rootRoute = createRootRoute({ component: Outlet });
  const landingRoute = createRoute({
    component: () =>
      createElement(
        Fragment,
        null,
        createElement(Header),
        createElement(HowItWorks),
        createElement(Pricing),
        createElement(FAQ),
        createElement(Footer)
      ),
    getParentRoute: () => rootRoute,
    path: '/',
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: rootRoute.addChildren([landingRoute]),
  });
  await router.load();

  const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
  const hrefs = Array.from(
    html.matchAll(/<a[^>]*\shref="([^"]*)"/g),
    (match) => match[1]
  );
  assert.ok(hrefs.length >= 10, `only ${hrefs.length} landing links rendered`);

  const sectionIds = landingSectionIds();
  const routePaths = existingRoutePaths();

  for (const href of hrefs) {
    assert.notEqual(href, '#', 'a bare "#" link is a dead link');
    assert.notEqual(href, '', 'an empty href is a dead link');
    if (href.startsWith('#')) {
      assert.ok(
        sectionIds.has(href.slice(1)),
        `anchor ${href} has no section on the mounted landing page`
      );
      continue;
    }
    assert.ok(href.startsWith('/'), `off-site landing link ${href}`);
    assert.ok(routePaths.has(href), `landing link ${href} has no route`);
  }
});

test('the landing page mounts no fabricated endorsement wall', () => {
  // T36 ruling: template customer logos (Acme Corp / Boltshift / …) were a
  // fabricated endorsement under a "built for every beauty craft" heading.
  const page = read(`${LANDING_DIR}/landing-page.tsx`);
  assert.doesNotMatch(page, /TrustedBy|trusted-by/u);
  for (const key of [
    'landing_trustedby_title',
    'landing_trustedby_subtitle',
    'landing_trustedby_cta',
    'landing_footer_social_wechat',
    'landing_footer_social_douyin',
    'landing_footer_social_xhs',
  ]) {
    assert.equal(zh[key], undefined, `${key} should be gone`);
    assert.equal(en[key], undefined, `${key} should be gone`);
  }
});
