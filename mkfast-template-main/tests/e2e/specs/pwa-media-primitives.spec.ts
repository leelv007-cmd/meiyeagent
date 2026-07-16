import { expect, test, type Page } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const CAMERA_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test.use({
  viewport: MOBILE_VIEWPORT,
  hasTouch: true,
  isMobile: true,
});

async function openProof(page: Page) {
  const response = await page.goto('/pwa-proof');

  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: '移动端能力验证' })
  ).toBeVisible();
  await expect(page.getByTestId('service-worker-status')).toContainText(
    'Service Worker 已就绪'
  );
}

test.describe('PWA and mobile media primitives', () => {
  test('registers the production-shaped service worker on mobile', async ({
    page,
    request,
  }) => {
    await openProof(page);

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.json'
    );
    await expect(page.getByTestId('service-worker-status')).toContainText(
      'Service Worker 已就绪'
    );

    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return {
        scope: ready.scope,
        scriptUrl: ready.active?.scriptURL ?? '',
      };
    });
    expect(new URL(registration.scope).pathname).toBe('/');
    expect(new URL(registration.scriptUrl).pathname).toBe('/sw.js');

    const workerResponse = await request.get('/sw.js');
    await expect(workerResponse).toBeOK();
    expect(workerResponse.headers()['service-worker-allowed']).toBe('/');

    const manifestResponse = await request.get('/manifest.json');
    await expect(manifestResponse).toBeOK();
    expect(await manifestResponse.json()).toMatchObject({
      background_color: '#46d3a3',
      theme_color: '#46d3a3',
    });

    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#46d3a3'
    );

    const overflowsViewport = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflowsViewport).toBe(false);

    await page.goto('/');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#46d3a3'
    );
  });

  test('returns a captured image fixture from the camera input', async ({
    page,
  }) => {
    await openProof(page);

    const cameraInput = page.getByTestId('camera-input');
    await expect(cameraInput).toHaveAttribute('accept', 'image/*');
    await expect(cameraInput).toHaveAttribute('capture', 'environment');

    await cameraInput.setInputFiles({
      name: 'camera-fixture.png',
      mimeType: 'image/png',
      buffer: CAMERA_FIXTURE,
    });

    await expect(page.getByAltText('相机回传预览')).toBeVisible();
    await expect(page.getByText('camera-fixture.png')).toBeVisible();
    await expect(page.getByTestId('camera-status')).toContainText(
      '已收到相机素材'
    );
  });

  test('explains how to recover when camera launch is blocked', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
        configurable: true,
        value() {
          throw new DOMException('Camera blocked', 'NotAllowedError');
        },
      });
    });
    await openProof(page);

    await page.getByRole('button', { name: '打开后置相机' }).click();

    await expect(page.getByTestId('camera-status')).toContainText(
      'Safari > 网站设置 > 相机'
    );
    await expect(page.getByTestId('camera-status')).toContainText('照片图库');
  });

  test('shares generated image and video fixtures with visible downloads', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data: ShareData) => Boolean(data.files?.length),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: ShareData) => {
          const sharedFiles = data.files?.map((file) => ({
            name: file.name,
            type: file.type,
          }));
          (
            window as typeof window & {
              __pwaSharedFiles?: Array<{ name: string; type: string }>;
            }
          ).__pwaSharedFiles = sharedFiles;
        },
      });
    });
    await openProof(page);

    const imageDownload = page.getByRole('link', { name: '下载图片' });
    const videoDownload = page.getByRole('link', { name: '下载视频' });
    await expect(imageDownload).toBeVisible();
    await expect(videoDownload).toBeVisible();
    await expect(imageDownload).toHaveAttribute(
      'download',
      'meiye-pwa-proof-image.png'
    );
    await expect(videoDownload).toHaveAttribute(
      'download',
      'meiye-pwa-proof-video.mp4'
    );

    await page.getByRole('button', { name: '分享图片' }).click();
    expect(
      await page.evaluate(
        () =>
          (
            window as typeof window & {
              __pwaSharedFiles?: Array<{ name: string; type: string }>;
            }
          ).__pwaSharedFiles
      )
    ).toEqual([{ name: 'meiye-pwa-proof-image.png', type: 'image/png' }]);

    await page.getByRole('button', { name: '分享视频' }).click();
    expect(
      await page.evaluate(
        () =>
          (
            window as typeof window & {
              __pwaSharedFiles?: Array<{ name: string; type: string }>;
            }
          ).__pwaSharedFiles
      )
    ).toEqual([{ name: 'meiye-pwa-proof-video.mp4', type: 'video/mp4' }]);
  });

  test('keeps an actionable download fallback after share rejection', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data: ShareData) => Boolean(data.files?.length),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          throw new DOMException('Share blocked', 'NotAllowedError');
        },
      });
    });
    await openProof(page);

    await page.getByRole('button', { name: '分享图片' }).click();

    await expect(page.getByTestId('share-status')).toContainText(
      '浏览器阻止了分享'
    );
    await expect(page.getByTestId('share-status')).toContainText('重试');
    await expect(page.getByRole('link', { name: '下载图片' })).toBeVisible();
  });
});
