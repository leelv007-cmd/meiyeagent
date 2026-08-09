import { expect, type Page } from '@playwright/test';

import { E2E_TEST_SECRET } from './test-data';
import { closeComposerCapsule, openComposerCapsule } from './ui-journey';

export const E2E_USER_SELECTED_SKILL_ID = 'skill.e2e-user-selected';
export const E2E_TENANT_ISOLATED_SKILL_ID = 'skill.e2e-tenant-isolated';

const fixtureHeaders = { 'x-e2e-secret': E2E_TEST_SECRET };

export type E2EUserSelectedSkillSeed = {
  ready: true;
  publicSkill: {
    skillId: string;
    skillRevisionRef: string;
    title: string;
    promptName: string;
    promptVersion: string;
    promptNameAtVersion: string;
  };
  tenantIsolatedSkill: {
    skillId: string;
    skillRevisionRef: string;
    title: string;
    tenantWorkspaceId: string;
  } | null;
};

export type E2EUserSelectedSkillEvidence = {
  taskId: string;
  workspaceId: string;
  userSelectedSkillRefs: string[];
  skillStages: Record<
    string,
    Array<{
      skillRevisionRef: string;
      contentHash: string;
      promptNameAtVersion: string | null;
    }>
  >;
  rootAxes: {
    skillRevision: string | null;
    promptVersion: string | null;
    catalogRevision: string | null;
    scene: string | null;
  } | null;
  assemblyAudits: Array<{
    primitiveId: string;
    skillRevision: string | null;
    promptVersion: string | null;
    catalogRevision: string | null;
    scene: string | null;
    axisScope: string | null;
  }>;
  injectedSkillRevisionRefs: string[];
};

/**
 * Server-side published fixture seed (Core E2E only). Optional foreign
 * workspace id installs a tenant-scoped pack for isolation assertions.
 */
export async function seedUserSelectedSkillFixture(
  page: Page,
  options: { foreignWorkspaceId?: string } = {}
): Promise<E2EUserSelectedSkillSeed> {
  const url = options.foreignWorkspaceId
    ? `/api/e2e/user-selected-skill-fixture?foreignWorkspaceId=${encodeURIComponent(options.foreignWorkspaceId)}`
    : '/api/e2e/user-selected-skill-fixture';
  const response = await page.request.post(url, { headers: fixtureHeaders });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { data?: E2EUserSelectedSkillSeed };
  expect(body.data?.ready).toBe(true);
  return body.data!;
}

export async function readUserSelectedSkillEvidence(
  page: Page,
  taskId: string
): Promise<E2EUserSelectedSkillEvidence> {
  const url = `/api/e2e/user-selected-skill-evidence?taskId=${encodeURIComponent(taskId)}`;
  // Admission is synchronous with the 202, but the probe is polled so 404s are
  // transient until the harness request row is visible to this connection.
  await expect
    .poll(
      async () => {
        const response = await page.request.post(url, {
          headers: fixtureHeaders,
        });
        if (!response.ok()) return null;
        const body = (await response.json()) as {
          data?: E2EUserSelectedSkillEvidence;
        };
        return body.data?.taskId === taskId ? body.data : null;
      },
      { timeout: 60_000 }
    )
    .not.toBeNull();

  const response = await page.request.post(url, { headers: fixtureHeaders });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as {
    data?: E2EUserSelectedSkillEvidence;
  };
  expect(body.data?.taskId).toBe(taskId);
  return body.data!;
}

/** Open the recipe capsule and wait for the merchant skill pill row. */
export async function openSkillCapabilityPills(page: Page) {
  await openComposerCapsule(page, 'recipe');
  const row = page.getByTestId('composer-skill-capability-pill-row');
  await expect(row).toBeVisible({ timeout: 60_000 });
  return row;
}

export async function selectUserSelectedSkillPill(page: Page, skillId: string) {
  await openSkillCapabilityPills(page);
  const pill = page.getByTestId(`composer-skill-selectable-${skillId}`);
  await expect(pill).toBeVisible();
  if ((await pill.getAttribute('data-selected')) !== 'true') {
    await pill.click();
  }
  await expect(pill).toHaveAttribute('data-selected', 'true');
  await closeComposerCapsule(
    page,
    page.getByTestId('composer-capsule-recipe-panel')
  );
}

export async function toggleOffUserSelectedSkillPill(
  page: Page,
  skillId: string
) {
  await openSkillCapabilityPills(page);
  const pill = page.getByTestId(`composer-skill-selectable-${skillId}`);
  await expect(pill).toBeVisible();
  if ((await pill.getAttribute('data-selected')) === 'true') {
    await pill.click();
  }
  await expect(pill).toHaveAttribute('data-selected', 'false');
  await closeComposerCapsule(
    page,
    page.getByTestId('composer-capsule-recipe-panel')
  );
}

export function parseSkillRevisionRef(ref: string): {
  skillId: string;
  skillVersion: string;
} {
  const at = ref.lastIndexOf('@');
  if (at <= 0) {
    return { skillId: ref, skillVersion: '' };
  }
  return {
    skillId: ref.slice(0, at),
    skillVersion: ref.slice(at + 1),
  };
}
