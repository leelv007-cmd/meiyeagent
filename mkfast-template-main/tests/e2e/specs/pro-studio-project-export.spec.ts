import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { unlockProStudio } from '../fixtures/pro-studio';

const INTERNAL_WORKSPACE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const INTERNAL_WORKSPACE_PREFIX =
  /^(?:workspace|ws|tenant|organization|org)[_-]/iu;

// Land inside the Canvas origin the same way the K3 retouch journey does: log in
// on the shell, unlock Pro Studio, then follow the one-click launch to the Canvas
// service. The Canvas port is read from the isolated e2e environment, never hard
// coded, so parallel agents keep their own stack.
async function enterCanvas(
  page: Page,
  request: Parameters<typeof registerE2EUser>[0]
) {
  const user = await registerE2EUser(request);
  await loginByForm(page, user);
  await page.goto('/pro-studio');
  await unlockProStudio(page);
  await page.reload();
  await page.getByRole('button', { name: '一键进入' }).click();
  const canvasOrigin = `http://localhost:${
    process.env.PLAYWRIGHT_CANVAS_PORT ?? '4200'
  }`;
  await expect(page).toHaveURL(
    (url) => url.origin === canvasOrigin && url.pathname === '/',
    { timeout: 20_000 }
  );
  await expect(page.getByText('Pro Studio', { exact: true })).toBeVisible();
}

async function createProject(page: Page, projectName: string) {
  await page
    .locator('.project-rail')
    .getByRole('button', { name: '新建', exact: true })
    .click();
  const createDialog = page.getByRole('dialog', { name: '新建工程' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('工程名称').fill(projectName);
  await createDialog.getByRole('button', { name: '创建工程' }).click();
  // The shell auto-opens the new project; the toolbar naming it is the hard
  // signal that creation persisted and loaded.
  await expect(page.locator('.canvas-toolbar')).toContainText(projectName);
}

test.describe('Pro Studio K6 project management and ZIP export parity (G43-G48)', () => {
  test.beforeAll(async ({ request }) => cleanupE2EUsers(request));
  test.afterAll(async ({ request }) => cleanupE2EUsers(request));

  test('project rail exposes a loading state, merchant-safe cards, and soft-deletes through a component dialog rather than window.confirm (G43-G46)', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);

    // G44 guard: any native window.confirm/prompt/alert surfaces here. The
    // journey must never trip this — deletion goes through an in-DOM dialog.
    const nativeDialogs: string[] = [];
    page.on('dialog', (dialog) => {
      nativeDialogs.push(dialog.type());
      void dialog.dismiss();
    });

    // G46: hold only the first listProjects so the loading skeleton is a
    // deterministic hard fact instead of a race with a fast local response.
    let releaseInitialList: (() => void) | null = null;
    const initialListGate = new Promise<void>((resolve) => {
      releaseInitialList = resolve;
    });
    let firstListHeld = false;
    await page.route('**/api/canvas/listProjects', async (route) => {
      if (!firstListHeld) {
        firstListHeld = true;
        await initialListGate;
      }
      await route.continue();
    });

    await enterCanvas(page, request);

    await test.step('G46 the project rail shows a busy loading state until projects resolve', async () => {
      await expect(page.getByText('正在加载工程')).toBeVisible();
      await expect(page.locator('.project-list')).toHaveAttribute(
        'aria-busy',
        'true'
      );
      releaseInitialList?.();
      await expect(page.getByText('正在加载工程')).toBeHidden();
      await expect(page.locator('.project-list')).toHaveAttribute(
        'aria-busy',
        'false'
      );
    });

    await test.step('G45 the workspace header never leaks an internal identifier', async () => {
      const workspaceName = page.locator('.workspace-name');
      await expect(workspaceName).toBeVisible();
      const nameText = (await workspaceName.textContent())?.trim() ?? '';
      expect(nameText.length).toBeGreaterThan(0);
      expect(nameText).not.toMatch(INTERNAL_WORKSPACE_UUID);
      expect(nameText).not.toMatch(INTERNAL_WORKSPACE_PREFIX);
    });

    const projectA = `k6-keep-${randomUUID().slice(0, 8)}`;
    const projectB = `k6-drop-${randomUUID().slice(0, 8)}`;
    const cardA = page.locator('.project-card').filter({ hasText: projectA });
    const cardB = page.locator('.project-card').filter({ hasText: projectB });

    await test.step('G43 created projects render as merchant-safe cards and stay openable', async () => {
      await createProject(page, projectA);
      await createProject(page, projectB);

      await expect(cardA).toBeVisible();
      await expect(cardB).toBeVisible();
      // G45 card projection: only node/edge counts and an update time, never a
      // persistence identifier or a raw graph node type.
      await expect(cardA.locator('small').first()).toHaveText(
        /\d+ 个节点 · \d+ 条连线/u
      );
      await expect(cardA.locator('small').nth(1)).toContainText('更新于');

      // Reopening the first card switches the active project back to it.
      await cardA.locator('.project-card-open').click();
      await expect(page.locator('.canvas-toolbar')).toContainText(projectA);
      await expect(cardA).toHaveClass(/active/u);
    });

    await test.step('G44 deleting a project opens the in-DOM confirmation dialog and soft-deletes on confirm', async () => {
      await cardB.getByRole('button', { name: `删除工程 ${projectB}` }).click();
      const deleteDialog = page.getByRole('dialog', {
        name: '删除 1 个工程？',
      });
      await expect(deleteDialog).toBeVisible();
      // The confirm control is the retention-move button, and the cancel path
      // is a real button — proof this is a component dialog, not a native one.
      await expect(
        deleteDialog.getByRole('button', { name: '取消' })
      ).toBeVisible();
      await deleteDialog
        .getByRole('button', { name: '移入回收保留区' })
        .click();
      await expect(deleteDialog).toBeHidden();
      await expect(cardB).toHaveCount(0);
      // The kept project is untouched by the soft delete.
      await expect(cardA).toBeVisible();
    });

    // G44 hard fact: no native confirm/alert dialog was ever raised.
    expect(nativeDialogs).toEqual([]);
  });

  test('exports a frozen checkpoint as a downloadable pro-studio-canvas-export/v1 ZIP (G48)', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(10_000);
    test.info().annotations.push({
      type: 'generation-mode',
      description: 'MODEL_EXECUTION_MODE=fixture',
    });

    // Capture the canvas actions and the export request body so the downloaded
    // manifest can be cross-checked against exactly what the client asked for.
    const uiActions: string[] = [];
    let exportRequest: { projectId?: string; revisionId?: string } | null =
      null;
    page.on('request', (request_) => {
      const match = new URL(request_.url()).pathname.match(
        /^\/api\/canvas\/([^/]+)$/u
      );
      if (!match?.[1]) return;
      uiActions.push(match[1]);
      if (match[1] === 'exportCanvas') {
        try {
          exportRequest = request_.postDataJSON() as {
            projectId?: string;
            revisionId?: string;
          };
        } catch {
          exportRequest = null;
        }
      }
    });

    await enterCanvas(page, request);

    const projectName = `k6-export-${randomUUID().slice(0, 8)}`;
    const toolbar = page.locator('.canvas-toolbar');

    await test.step('creates a project with graph content and freezes an immutable checkpoint', async () => {
      await createProject(page, projectName);
      // A text node gives the frozen revision real graph content to carry into
      // revision.json without depending on any Core asset retrieval.
      await toolbar.getByRole('button', { name: '文字节点' }).click();
      await toolbar
        .getByRole('button', { name: '检查点', exact: true })
        .click();
      // The revision strip gaining a checkpoint button is the durable signal
      // that a frozen revision now exists and export is reachable.
      await expect(page.locator('.revision-strip button')).not.toHaveCount(0);
    });

    let download: import('@playwright/test').Download;
    await test.step('G48 opens the export dialog and downloads the frozen checkpoint ZIP', async () => {
      await toolbar.getByRole('button', { name: '导出', exact: true }).click();
      const exportDialog = page.getByRole('dialog', { name: '导出工程' });
      await expect(exportDialog).toBeVisible();
      // The frozen checkpoint is preselected, so the download control is live.
      await expect(page.locator('#canvas-export-revision')).not.toHaveValue('');

      const downloadPromise = page.waitForEvent('download');
      await exportDialog.getByRole('button', { name: '下载 ZIP' }).click();
      download = await downloadPromise;
      expect(download.suggestedFilename()).toBe('canvas-export.zip');
    });

    await test.step('the download is a well-formed pro-studio-canvas-export/v1 archive', async () => {
      const zipPath = await download.path();
      expect(zipPath).toBeTruthy();
      const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
      const entryNames = Object.keys(entries).sort();
      // The archive is bounded and deterministic: a manifest plus the frozen
      // revision, with no stray files (no assets were referenced by this graph).
      expect(entryNames).toEqual(['manifest.json', 'revision.json']);

      const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as {
        assets: unknown[];
        exportReceiptId: string;
        format: string;
        project: { id: string; revisionId: string };
        warnings: unknown[];
      };
      expect(manifest.format).toBe('pro-studio-canvas-export/v1');
      expect(manifest.exportReceiptId.length).toBeGreaterThan(0);
      expect(Array.isArray(manifest.assets)).toBe(true);
      expect(manifest.assets).toHaveLength(0);
      expect(manifest.warnings).toHaveLength(0);
      expect(manifest.project.id.length).toBeGreaterThan(0);
      expect(manifest.project.revisionId.length).toBeGreaterThan(0);

      // The manifest must describe exactly the project/revision the client
      // requested — the export never silently retargets.
      expect(exportRequest).not.toBeNull();
      expect(manifest.project.id).toBe(exportRequest?.projectId);
      expect(manifest.project.revisionId).toBe(exportRequest?.revisionId);

      const revision = JSON.parse(strFromU8(entries['revision.json'])) as {
        graph: { nodes: unknown[] };
        id: string;
        projectId: string;
      };
      expect(revision.id).toBe(manifest.project.revisionId);
      expect(revision.projectId).toBe(manifest.project.id);
      // The frozen revision carries the text node added before the checkpoint.
      expect(revision.graph.nodes.length).toBeGreaterThan(0);
    });

    await test.step('the shell reports an honest, merchant-safe download receipt', async () => {
      await expect(
        page.getByText(/已安全下载 canvas-export\.zip/u)
      ).toBeVisible();
    });

    // The export travelled through the dedicated canvas export action.
    expect(uiActions).toEqual(
      expect.arrayContaining(['createProject', 'exportCanvas'])
    );
  });
});
