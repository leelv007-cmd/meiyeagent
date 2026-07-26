import { expect, test, type Locator } from '@playwright/test';

import {
  cleanupE2EUsers,
  loginByForm,
  registerE2EUser,
} from '../fixtures/auth';

async function currentQuestion(
  manager: Locator,
  question: string
): Promise<{ input: Locator; region: Locator }> {
  const region = manager.getByRole('region', { name: question });
  await expect(region).toBeFocused();
  await expect(manager.locator('[aria-live="polite"]')).toHaveText(question);
  return {
    input: region.getByRole('textbox', { name: question }),
    region,
  };
}

async function answerTextQuestion(
  manager: Locator,
  question: string,
  answer: string
) {
  const { input, region } = await currentQuestion(manager, question);
  await input.pressSequentially(answer);
  await region.getByRole('button', { name: '继续' }).click();
}

test('identity registration stays single-question, editable, and accessible', async ({
  page,
  request,
}) => {
  const user = await registerE2EUser(request);
  try {
    await loginByForm(page, user);
    // T33 / #227: identity management has its own page now; the asset page
    // keeps a summary and the way in.
    await page.goto('/dashboard/identity');

    const manager = page.getByRole('region', { name: '表达身份' });
    await expect(manager.locator('form')).toHaveCount(0);
    await expect(
      manager.getByRole('heading', {
        name: '这次要登记品牌身份，还是个人 IP？',
      })
    ).toBeVisible();

    await manager.getByRole('button', { name: '品牌', exact: true }).click();
    const displayNameQuestion = '希望在内容里怎么称呼这个身份？';
    const { input: displayName } = await currentQuestion(
      manager,
      displayNameQuestion
    );
    await displayName.pressSequentially('Qing He');
    await expect(displayName).toHaveValue('Qing He');
    await manager.getByRole('button', { name: '继续' }).click();

    await answerTextQuestion(manager, '这个身份归属于谁？', 'Qing He Studio');
    await answerTextQuestion(
      manager,
      '这个品牌最核心的主张是什么？',
      'Calm professional care'
    );
    await answerTextQuestion(
      manager,
      '哪些话或做法绝对不能碰？',
      'No medical claims'
    );

    const samplesQuestion = '给一两句最能代表这个身份的表达样例。';
    const { input: samples, region: samplesRegion } = await currentQuestion(
      manager,
      samplesQuestion
    );
    await samples.pressSequentially('First line');
    await samples.press('Enter');
    await samples.pressSequentially('Second line');
    await expect(samples).toHaveValue('First line\nSecond line');
    await samplesRegion.getByRole('button', { name: '继续' }).click();

    await answerTextQuestion(
      manager,
      '授权证明或内部备注是什么？（可填编号）',
      'identity-e2e-brand-1'
    );

    for (const question of [
      '有哪些话这个品牌坚决不说？',
      '画面希望长期保持什么感觉？',
      '有哪些栏目值得长期连续做？',
    ]) {
      const { region } = await currentQuestion(manager, question);
      await region.getByRole('button', { name: '暂时跳过' }).click();
    }

    const preview = manager.getByRole('region', {
      name: '确认后保存为表达身份',
    });
    await expect(preview).toBeFocused();
    await expect(manager.locator('[aria-live="polite"]')).toHaveText(
      '确认后保存为表达身份'
    );
    await expect(preview).not.toContainText('身份资产');

    await manager
      .getByRole('button', {
        name: `${displayNameQuestion} · 点击修改`,
      })
      .click();
    const editedName = (await currentQuestion(manager, displayNameQuestion))
      .input;
    await editedName.fill('Qing He Studio');
    await manager.getByRole('button', { name: '继续' }).click();
    await expect(preview).toBeFocused();
    await expect(preview).toContainText('Qing He Studio');

    await preview.getByRole('button', { name: '登记身份' }).click();
    const savedIdentity = manager
      .locator('article')
      .filter({ hasText: 'Qing He Studio' });
    await expect(savedIdentity).toHaveCount(1);
    await expect(
      savedIdentity.getByText('Qing He Studio', { exact: true })
    ).toBeVisible();
    await expect(
      savedIdentity.getByText('生效中', { exact: true })
    ).toBeVisible();
    await expect(manager.getByText('active', { exact: true })).toHaveCount(0);
    await expect(manager.getByText('V1', { exact: true })).toHaveCount(0);
  } finally {
    await cleanupE2EUsers(request);
  }
});
