import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

const PRE_CUTOVER_ENVELOPE = {
  highImpactViolations: {} as Record<string, number>,
  maxCls: 0.1,
  maxCoreRequests: 24,
  maxCriticalQueries: 6,
  maxDomNodes: 534,
  maxFeedbackMs: 200,
  maxHorizontalOverflowAt200Percent: 0,
  maxInpMs: 200,
  maxInitialTransferBytes: 700 * 1024,
  maxLcpMs: 2_500,
  maxLongTaskMs: 200,
  maxLongTaskTotalMs: 200,
  maxTtfbMs: 800,
};

test('dashboard stays within the recorded pre-cutover quality envelope', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const productionCandidate =
    process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE === 'true';
  const user = await registerE2EUser(request, { role: 'admin' });

  try {
    await loginByForm(page, user);
    const coreRequests: string[] = [];
    const criticalQueries = new Set<string>();
    page.on('request', (browserRequest) => {
      const url = new URL(browserRequest.url());
      if (url.pathname.startsWith('/api/core/')) {
        coreRequests.push(url.pathname);
        if (url.pathname === '/api/core/product/state') {
          criticalQueries.add('product.state');
        }
        if (url.pathname === '/api/core/p1/query') {
          try {
            const body = browserRequest.postDataJSON() as {
              action?: string;
              module?: string;
            };
            if (body.action && body.module) {
              criticalQueries.add(`${body.module}.${body.action}`);
            }
          } catch {
            criticalQueries.add('p1.unknown');
          }
        }
      }
    });

    await page.addInitScript(() => {
      const target = window as unknown as {
        __meiyeLabMetrics: {
          cls: number;
          feedbackMs?: number;
          inp: number;
          interactionLongTaskIndex?: number;
          lcp: number;
          lcpEntry?: Record<string, number | string>;
          longTasks: number[];
        };
      };
      target.__meiyeLabMetrics = {
        cls: 0,
        inp: 0,
        lcp: 0,
        longTasks: [],
      };
      const observe = (
        type: string,
        callback: PerformanceObserverCallback,
        options: PerformanceObserverInit = { buffered: true, type }
      ) => {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
        const observer = new PerformanceObserver(callback);
        observer.observe(options);
      };
      observe('largest-contentful-paint', (list) => {
        const entry = list.getEntries().at(-1) as
          | (PerformanceEntry & {
              element?: Element;
              loadTime?: number;
              renderTime?: number;
              size?: number;
              url?: string;
            })
          | undefined;
        if (!entry) return;
        target.__meiyeLabMetrics.lcp = entry.startTime;
        target.__meiyeLabMetrics.lcpEntry = {
          element: entry.element?.tagName.toLowerCase() ?? 'unknown',
          loadTime: entry.loadTime ?? 0,
          renderTime: entry.renderTime ?? 0,
          size: entry.size ?? 0,
          url: entry.url ? new URL(entry.url).pathname : '',
        };
      });
      observe('layout-shift', (list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          if (!shift.hadRecentInput)
            target.__meiyeLabMetrics.cls += shift.value;
        }
      });
      observe(
        'event',
        (list) => {
          for (const entry of list.getEntries()) {
            const event = entry as PerformanceEntry & {
              duration: number;
              interactionId: number;
            };
            if (event.interactionId > 0) {
              target.__meiyeLabMetrics.inp = Math.max(
                target.__meiyeLabMetrics.inp,
                event.duration
              );
            }
          }
        },
        {
          buffered: true,
          durationThreshold: 16,
          type: 'event',
        } as PerformanceObserverInit
      );
      observe('longtask', (list) => {
        target.__meiyeLabMetrics.longTasks.push(
          ...list.getEntries().map((entry) => entry.duration)
        );
      });
    });
    const cdp = productionCandidate
      ? await page.context().newCDPSession(page)
      : undefined;
    if (cdp) {
      await cdp.send('Network.enable');
      await cdp.send('Network.setBypassServiceWorker', { bypass: true });
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', {
        connectionType: 'cellular4g',
        downloadThroughput: 200_000,
        latency: 150,
        offline: false,
        uploadThroughput: 93_750,
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '暂时跳过' })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(250);

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const highImpactViolations = Object.fromEntries(
      axe.violations
        .filter(
          (violation) =>
            violation.impact === 'critical' || violation.impact === 'serious'
        )
        .map((violation): [string, number] => [
          violation.id,
          violation.nodes.length,
        ])
        .sort(([left], [right]) => left.localeCompare(right))
    );
    const domNodes = await page.locator('*').count();

    const skipPersisted = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === '/api/core/p1/commands' &&
        request.method() === 'POST' &&
        request.postData()?.includes('record_onboarding_skip') === true
      );
    });
    const projectionRefreshed = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === '/api/core/p1/query' &&
        request.method() === 'POST' &&
        request.postData()?.includes('creative_workbench') === true
      );
    });
    await page.getByRole('button', { name: '暂时跳过' }).click();
    expect((await skipPersisted).ok()).toBe(true);
    expect((await projectionRefreshed).ok()).toBe(true);
    await expect(
      page.getByRole('heading', { name: '弥鹿美甲示例店' })
    ).toBeVisible();

    await page.evaluate(() => {
      const target = window as unknown as {
        __meiyeLabMetrics: {
          feedbackMs?: number;
          interactionLongTaskIndex?: number;
          longTasks: number[];
        };
      };
      const startedAt = performance.now();
      target.__meiyeLabMetrics.interactionLongTaskIndex =
        target.__meiyeLabMetrics.longTasks.length;
      const observer = new MutationObserver(() => {
        if (!document.body.textContent?.includes('内容簿还是空的')) return;
        target.__meiyeLabMetrics.feedbackMs = performance.now() - startedAt;
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    const exampleHidden = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(response.url()).pathname === '/api/core/product/commands' &&
        request.method() === 'POST' &&
        request.postData()?.includes('hide_example') === true
      );
    });
    await page.getByRole('button', { name: '隐藏示例' }).click();
    await expect(page.getByText('内容簿还是空的')).toBeVisible();
    expect((await exampleHidden).ok()).toBe(true);
    await page.waitForTimeout(100);

    await page.keyboard.press('Tab');
    const focusedElement = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      return {
        tagName: element.tagName.toLowerCase(),
        hasAccessibleName: Boolean(
          element.getAttribute('aria-label')?.trim() ||
            element.textContent?.trim() ||
            element.getAttribute('title')?.trim()
        ),
      };
    });

    await page.setViewportSize({ width: 640, height: 720 });
    const horizontalOverflowAt200Percent = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    const lab = await page.evaluate(
      (profile) => {
        const metrics = (
          window as unknown as {
            __meiyeLabMetrics: {
              cls: number;
              feedbackMs?: number;
              inp: number;
              interactionLongTaskIndex?: number;
              lcp: number;
              lcpEntry?: Record<string, number | string>;
              longTasks: number[];
            };
          }
        ).__meiyeLabMetrics;
        const navigation = performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined;
        const resources = performance.getEntriesByType(
          'resource'
        ) as PerformanceResourceTiming[];
        const initialBoundary = Math.max(
          navigation?.loadEventEnd ?? 0,
          metrics.lcp + 50
        );
        const initialResources = resources.filter(
          (entry) => entry.responseEnd <= initialBoundary
        );
        const initialTransferBytes =
          (navigation?.transferSize || navigation?.encodedBodySize || 0) +
          initialResources.reduce(
            (total, entry) =>
              total + (entry.transferSize || entry.encodedBodySize || 0),
            0
          );
        const interactionLongTasks = metrics.longTasks
          .slice(metrics.interactionLongTaskIndex ?? metrics.longTasks.length)
          .filter((duration) => duration > 50);
        return {
          ...metrics,
          criticalResources: (
            performance.getEntriesByType(
              'resource'
            ) as PerformanceResourceTiming[]
          )
            .filter((entry) => entry.responseEnd <= metrics.lcp + 50)
            .sort((left, right) => right.responseEnd - left.responseEnd)
            .slice(0, 12)
            .map((entry) => ({
              duration: Math.round(entry.duration),
              initiatorType: entry.initiatorType,
              path: new URL(entry.name, window.location.href).pathname,
              responseEnd: Math.round(entry.responseEnd),
              transferSize: entry.transferSize,
            })),
          domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
          interactionLongTaskTotalMs: interactionLongTasks.reduce(
            (total, duration) => total + duration,
            0
          ),
          initialResources: initialResources.map((entry) => ({
            bytes: entry.transferSize || entry.encodedBodySize || 0,
            path: new URL(entry.name, window.location.href).pathname,
          })),
          initialTransferBytes,
          longTaskMaxMs: Math.max(0, ...metrics.longTasks),
          loadEventMs: navigation?.loadEventEnd ?? 0,
          profile,
          ttfbMs: navigation?.responseStart ?? 0,
        };
      },
      productionCandidate ? '4x CPU + Fast 4G' : 'local development'
    );
    if (cdp) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await cdp.send('Network.setBypassServiceWorker', { bypass: false });
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      await cdp.send('Network.emulateNetworkConditions', {
        downloadThroughput: -1,
        latency: 0,
        offline: false,
        uploadThroughput: -1,
      });
    }

    const report = {
      axeViolationCounts: Object.fromEntries(
        axe.violations
          .map((violation): [string, number] => [
            violation.id,
            violation.nodes.length,
          ])
          .sort(([left], [right]) => left.localeCompare(right))
      ),
      coreRequestCount: coreRequests.length,
      criticalQueries: [...criticalQueries].sort(),
      domNodes,
      focusedElement,
      highImpactViolations,
      horizontalOverflowAt200Percent,
      lab,
    };
    if (productionCandidate) {
      console.info('UIUX_QUALITY_REPORT', JSON.stringify(report));
    }
    await test.info().attach('uiux-precutover-baseline', {
      body: Buffer.from(JSON.stringify(report, null, 2)),
      contentType: 'application/json',
    });

    expect(highImpactViolations).toEqual(
      PRE_CUTOVER_ENVELOPE.highImpactViolations
    );
    expect(coreRequests.length).toBeLessThanOrEqual(
      PRE_CUTOVER_ENVELOPE.maxCoreRequests
    );
    expect(criticalQueries.size).toBeLessThanOrEqual(
      PRE_CUTOVER_ENVELOPE.maxCriticalQueries
    );
    expect(domNodes).toBeLessThanOrEqual(PRE_CUTOVER_ENVELOPE.maxDomNodes);
    expect(horizontalOverflowAt200Percent).toBeLessThanOrEqual(
      PRE_CUTOVER_ENVELOPE.maxHorizontalOverflowAt200Percent
    );
    expect(focusedElement?.hasAccessibleName).toBe(true);
    expect(lab.lcp).toBeGreaterThan(0);
    expect(lab.lcp).toBeLessThanOrEqual(PRE_CUTOVER_ENVELOPE.maxLcpMs);
    expect(lab.cls).toBeLessThanOrEqual(PRE_CUTOVER_ENVELOPE.maxCls);
    expect(lab.inp).toBeGreaterThan(0);
    expect(lab.inp).toBeLessThanOrEqual(PRE_CUTOVER_ENVELOPE.maxInpMs);
    if (productionCandidate) {
      expect(lab.initialTransferBytes).toBeLessThanOrEqual(
        PRE_CUTOVER_ENVELOPE.maxInitialTransferBytes
      );
    }
    expect(lab.feedbackMs).toBeLessThanOrEqual(
      PRE_CUTOVER_ENVELOPE.maxFeedbackMs
    );
    expect(lab.longTaskMaxMs).toBeLessThanOrEqual(
      PRE_CUTOVER_ENVELOPE.maxLongTaskMs
    );
    expect(lab.interactionLongTaskTotalMs).toBeLessThanOrEqual(
      PRE_CUTOVER_ENVELOPE.maxLongTaskTotalMs
    );
    expect(lab.ttfbMs).toBeLessThanOrEqual(PRE_CUTOVER_ENVELOPE.maxTtfbMs);
  } finally {
    await cleanupE2EUsers(request);
  }
});
