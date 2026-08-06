/**
 * Spec E / #382 — merchant user_selected journey acceptance gate.
 *
 * Real BFF/Core path with published E2E fixtures (not admin route-mock).
 * Chain: defined → accepted_frozen → bound → exposed → invoked → persisted/traced.
 *
 * Driver runs Playwright. Admin dashboard-shell route-mocks stay as admin
 * rendering regressions only.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';
import { seedConfirmedStore } from '../fixtures/product';
import {
  E2E_TENANT_ISOLATED_SKILL_ID,
  E2E_USER_SELECTED_SKILL_ID,
  openSkillCapabilityPills,
  parseSkillRevisionRef,
  readUserSelectedSkillEvidence,
  seedUserSelectedSkillFixture,
  selectUserSelectedSkillPill,
  toggleOffUserSelectedSkillPill,
} from '../fixtures/user-selected-skill';
import {
  JOURNEY_CONTRACTS,
  selectComposerLens,
  submitComposerJourney,
} from '../fixtures/ui-journey';

const COPY_CONTRACT = JOURNEY_CONTRACTS.find(
  (contract) => contract.modality === 'copy'
)!;

async function merchantWorkspaceId(page: Page): Promise<string> {
  const workspaceId = await page.evaluate(async () => {
    const response = await fetch('/api/core/product/state', {
      credentials: 'same-origin',
    });
    const envelope = (await response.json()) as {
      data?: { workspaceId?: string };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data?.workspaceId) {
      throw new Error(
        envelope.error?.message ?? 'product state missing workspaceId'
      );
    }
    return envelope.data.workspaceId;
  });
  expect(workspaceId).toBeTruthy();
  return workspaceId;
}

test.describe('Spec E / #382 merchant user_selected skill journey', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test.afterAll(async ({ request }) => {
    test.setTimeout(180_000);
    await cleanupE2EUsers(request);
  });

  test('select → submit → inject → result → audit axes (real BFF/Core)', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const seeded = await seedUserSelectedSkillFixture(page);
    expect(seeded.publicSkill.skillId).toBe(E2E_USER_SELECTED_SKILL_ID);

    await page.goto('/dashboard');
    await expect(page.getByTestId('composer-home')).toBeVisible();
    await selectComposerLens(page, 'copy');
    await selectUserSelectedSkillPill(page, E2E_USER_SELECTED_SKILL_ID);

    let submittedTaskId = '';
    const intent = `E2E user_selected inject ${crypto.randomUUID()} 朋友圈项目介绍`;
    await submitComposerJourney(page, COPY_CONTRACT, intent, {
      openResult: false,
      onSubmissionAccepted: ({ taskId }) => {
        submittedTaskId = taskId;
      },
    });
    expect(submittedTaskId).toBeTruthy();

    // Wait for admission freeze to land in harness_runtime.task_requests.
    let evidence = await readUserSelectedSkillEvidence(page, submittedTaskId);
    await expect
      .poll(
        async () => {
          evidence = await readUserSelectedSkillEvidence(page, submittedTaskId);
          return evidence.userSelectedSkillRefs.includes(
            seeded.publicSkill.skillRevisionRef
          );
        },
        { timeout: 60_000 }
      )
      .toBe(true);

    expect(evidence.userSelectedSkillRefs).toContain(
      seeded.publicSkill.skillRevisionRef
    );
    expect(evidence.injectedSkillRevisionRefs).toContain(
      seeded.publicSkill.skillRevisionRef
    );

    const intentStage = evidence.skillStages.intent_naming ?? [];
    const injected = intentStage.find(
      (entry) =>
        entry.skillRevisionRef === seeded.publicSkill.skillRevisionRef
    );
    expect(injected, 'user_selected skill must freeze into intent_naming').toBeTruthy();
    expect(injected!.contentHash.length).toBeGreaterThan(0);
    expect(injected!.promptNameAtVersion).toBe(
      seeded.publicSkill.promptNameAtVersion
    );

    const { skillId, skillVersion } = parseSkillRevisionRef(
      seeded.publicSkill.skillRevisionRef
    );
    expect(skillId).toBe(E2E_USER_SELECTED_SKILL_ID);
    expect(skillVersion).toBeTruthy();

    // Audit: task_pin carries catalogRevision + scene; stage material carries
    // skillId@skillVersion + promptName@promptVersion (D-165 / Spec E).
    const taskPin = evidence.assemblyAudits.find(
      (event) => event.primitiveId === 'harness-assembly:task_pin'
    );
    expect(taskPin, 'task_pin assembly audit must exist').toBeTruthy();
    expect(taskPin!.axisScope).toBe('task_root');
    expect(taskPin!.catalogRevision ?? evidence.rootAxes?.catalogRevision).toBeTruthy();
    expect(taskPin!.scene ?? evidence.rootAxes?.scene).toBeTruthy();
    expect(injected!.promptNameAtVersion).toMatch(/@.+/u);
    expect(seeded.publicSkill.skillRevisionRef).toBe(
      `${skillId}@${skillVersion}`
    );
  });

  test('cancel selection → submit does not inject user_selected skill', async ({
    page,
    request,
  }) => {
    test.setTimeout(360_000);
    const user = await registerE2EUser(request);
    await loginByForm(page, user);
    await seedConfirmedStore(page);

    const seeded = await seedUserSelectedSkillFixture(page);
    await page.goto('/dashboard');
    await selectComposerLens(page, 'copy');

    // Select then cancel (confirm-style toggle).
    await selectUserSelectedSkillPill(page, E2E_USER_SELECTED_SKILL_ID);
    await toggleOffUserSelectedSkillPill(page, E2E_USER_SELECTED_SKILL_ID);

    let submittedTaskId = '';
    const intent = `E2E user_selected cancel ${crypto.randomUUID()} 朋友圈项目介绍`;
    await submitComposerJourney(page, COPY_CONTRACT, intent, {
      openResult: false,
      onSubmissionAccepted: ({ taskId }) => {
        submittedTaskId = taskId;
      },
    });
    expect(submittedTaskId).toBeTruthy();

    let evidence = await readUserSelectedSkillEvidence(page, submittedTaskId);
    await expect
      .poll(
        async () => {
          evidence = await readUserSelectedSkillEvidence(page, submittedTaskId);
          return evidence.userSelectedSkillRefs.length === 0;
        },
        { timeout: 60_000 }
      )
      .toBe(true);

    expect(evidence.userSelectedSkillRefs).not.toContain(
      seeded.publicSkill.skillRevisionRef
    );
    expect(evidence.injectedSkillRevisionRefs).not.toContain(
      seeded.publicSkill.skillRevisionRef
    );
    const intentStage = evidence.skillStages.intent_naming ?? [];
    expect(
      intentStage.some(
        (entry) =>
          entry.skillRevisionRef === seeded.publicSkill.skillRevisionRef
      )
    ).toBe(false);
  });

  test('tenant isolation: foreign workspace skill is not visible or selectable', async ({
    browser,
    request,
  }) => {
    test.setTimeout(360_000);

    const owner = await registerE2EUser(request);
    const stranger = await registerE2EUser(request);

    const ownerContext = await browser.newContext();
    const strangerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const strangerPage = await strangerContext.newPage();

    try {
      await loginByForm(ownerPage, owner);
      await seedConfirmedStore(ownerPage);
      const ownerWorkspaceId = await merchantWorkspaceId(ownerPage);

      await loginByForm(strangerPage, stranger);
      await seedConfirmedStore(strangerPage);

      // Stranger seeds with foreignWorkspaceId = owner → tenant pack is owner-only.
      const seeded = await seedUserSelectedSkillFixture(strangerPage, {
        foreignWorkspaceId: ownerWorkspaceId,
      });
      expect(seeded.tenantIsolatedSkill?.tenantWorkspaceId).toBe(
        ownerWorkspaceId
      );
      expect(seeded.tenantIsolatedSkill?.skillId).toBe(
        E2E_TENANT_ISOLATED_SKILL_ID
      );

      // Owner can see the tenant-isolated pack.
      await ownerPage.goto('/dashboard');
      await selectComposerLens(ownerPage, 'copy');
      await openSkillCapabilityPills(ownerPage);
      await expect(
        ownerPage.getByTestId(
          `composer-skill-selectable-${E2E_TENANT_ISOLATED_SKILL_ID}`
        )
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        ownerPage.getByTestId(
          `composer-skill-selectable-${E2E_USER_SELECTED_SKILL_ID}`
        )
      ).toBeVisible();

      // Stranger must not see or select the owner-scoped pack.
      await strangerPage.goto('/dashboard');
      await selectComposerLens(strangerPage, 'copy');
      await openSkillCapabilityPills(strangerPage);
      await expect(
        strangerPage.getByTestId(
          `composer-skill-selectable-${E2E_USER_SELECTED_SKILL_ID}`
        )
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        strangerPage.getByTestId(
          `composer-skill-selectable-${E2E_TENANT_ISOLATED_SKILL_ID}`
        )
      ).toHaveCount(0);

      // Projection query also excludes the foreign pack (server authority).
      const strangerProjection = await strangerPage.evaluate(async () => {
        const response = await fetch('/api/core/p1/query', {
          body: JSON.stringify({
            action: 'merchant_skill_projection',
            module: 'skills',
            payload: { lensId: 'copy' },
          }),
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        const envelope = (await response.json()) as {
          data?: { items?: Array<{ skillId: string }> };
        };
        if (!response.ok) {
          throw new Error('merchant_skill_projection failed');
        }
        return envelope.data?.items ?? [];
      });
      expect(
        strangerProjection.some(
          (item) => item.skillId === E2E_TENANT_ISOLATED_SKILL_ID
        )
      ).toBe(false);
      expect(
        strangerProjection.some(
          (item) => item.skillId === E2E_USER_SELECTED_SKILL_ID
        )
      ).toBe(true);
    } finally {
      await ownerContext.close();
      await strangerContext.close();
    }
  });
});
