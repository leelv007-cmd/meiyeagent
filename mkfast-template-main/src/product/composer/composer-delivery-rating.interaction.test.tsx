/**
 * RTL: 成品卡评价条 ＋ 后续动作 chip (D-160③ / D-164⑤, #261 Step 6).
 *
 * 断言按可读文本与行为走，不数 testid 个数：评价条是纯图标的，「有三个按钮」这种
 * 计数断言在图标换错、aria-label 掉了、chip 变成直接提交时都仍然是绿的。
 */
import {
  creationLensIds,
  type ContentPackageRevisionDelivery,
} from '@meiye/contracts';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerDeliveryCard } from './composer-delivery-card';
import {
  DELIVERY_FOLLOWUP_MIN_VISIBLE,
  listDeliveryFollowUps,
} from './delivery-followup-seeds';

afterEach(() => {
  cleanup();
});

const REVISION: ContentPackageRevisionDelivery = {
  packageId: 'package-a',
  revision: 2,
  versionId: 'version-a',
};

/** 卡外包一层 form：chip 若被改成 submit，这个 spy 是唯一会响的证人。 */
function renderCard(
  props: Partial<Parameters<typeof ComposerDeliveryCard>[0]> = {}
) {
  const onOpen = vi.fn();
  const onRate = vi.fn();
  const onFollowUp = vi.fn();
  const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());

  render(
    <form onSubmit={onSubmit}>
      <ComposerDeliveryCard
        excerpt={{
          body: '门店开业第一批体验名额已经开放。',
          title: '开业笔记',
        }}
        lensId="image_text"
        onFollowUp={onFollowUp}
        onOpen={onOpen}
        onRate={onRate}
        revision={REVISION}
        statement="这一版按开业活动写，突出限时名额。"
        taskId="task-a"
        workId="work-a"
        {...props}
      />
    </form>
  );

  return { onFollowUp, onOpen, onRate, onSubmit };
}

function ratingGroup() {
  return screen.getByRole('group', { name: '对这一版的评价' });
}

describe('成品卡评价条', () => {
  it('只出复制/点赞/点踩三个具名动作，不渲染「更多」', () => {
    renderCard();

    const names = within(ratingGroup())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));

    // 逐条读名字而不是数个数：纯图标按钮丢了 aria-label 就是读屏用户的死角。
    expect(names).toEqual(['复制文案', '这一版好用', '这一版不好用']);
    // 「更多」在本仓无下游菜单，首版不渲染（08-reconciliation M6）。
    expect(
      within(ratingGroup()).queryByTestId('composer-delivery-rating-more')
    ).toBeNull();
    expect(screen.queryByLabelText('更多操作')).toBeNull();
  });

  it('赞与踩互斥，再点同一个＝撤回，每一次点击都上报一条', async () => {
    const user = userEvent.setup();
    const { onOpen, onRate } = renderCard();

    const up = screen.getByRole('button', { name: '这一版好用' });
    const down = screen.getByRole('button', { name: '这一版不好用' });

    await user.click(up);
    expect(onRate.mock.calls).toEqual([
      [
        {
          action: 'up',
          idempotencyKey: expect.any(String),
          previousVerdict: null,
          nextVerdict: 'up',
        },
      ],
    ]);
    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(down).toHaveAttribute('aria-pressed', 'false');
    // 视觉反馈只有图标变色，读屏用户拿这条 sr-only 播报。
    expect(within(ratingGroup()).getByText('已记下：好用')).toBeInTheDocument();

    await user.click(down);
    expect(onRate.mock.calls.at(-1)).toEqual([
      {
        action: 'down',
        idempotencyKey: expect.any(String),
        previousVerdict: 'up',
        nextVerdict: 'down',
      },
    ]);
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(down).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(ratingGroup()).getByText('已记下：不好用')
    ).toBeInTheDocument();

    // 撤回：UI 复位，但事件照发 —— 前端不做去重，「商家改了主意」是最强的一条
    // 时序证据，在信号进入之前合并掉等于先把它丢了。
    await user.click(down);
    expect(onRate.mock.calls.at(-1)).toEqual([
      {
        action: 'down',
        idempotencyKey: expect.any(String),
        previousVerdict: 'down',
        nextVerdict: null,
      },
    ]);
    expect(down).toHaveAttribute('aria-pressed', 'false');
    expect(within(ratingGroup()).queryByText('已记下：不好用')).toBeNull();

    // R-05：评价不是一条写路径，不得顺带打开结果中心。
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('only shows a rating after the canonical append is acknowledged', async () => {
    const user = userEvent.setup();
    let acknowledge!: () => void;
    const pending = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    renderCard({ onRate: () => pending });
    const up = screen.getByRole('button', { name: '这一版好用' });

    await user.click(up);
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(up).toBeDisabled();
    expect(screen.getByRole('button', { name: '这一版不好用' })).toBeDisabled();

    acknowledge();
    await pending;
    await waitFor(() => expect(up).toHaveAttribute('aria-pressed', 'true'));
    expect(up).not.toBeDisabled();
  });

  it('serializes rating writes and reuses the transition key after an ambiguous failure', async () => {
    const user = userEvent.setup();
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const onRate = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(undefined);
    renderCard({ onRate });
    const up = screen.getByRole('button', { name: '这一版好用' });
    const down = screen.getByRole('button', { name: '这一版不好用' });

    await user.click(up);
    await user.click(down);
    expect(onRate).toHaveBeenCalledTimes(1);

    rejectFirst(new Error('response lost after commit'));
    await first.catch(() => undefined);
    await waitFor(() => expect(up).not.toBeDisabled());
    expect(up).toHaveAttribute('aria-pressed', 'false');

    await user.click(up);
    expect(onRate).toHaveBeenCalledTimes(2);
    expect(onRate.mock.calls[1]?.[0].idempotencyKey).toBe(
      onRate.mock.calls[0]?.[0].idempotencyKey
    );
    await waitFor(() => expect(up).toHaveAttribute('aria-pressed', 'true'));
  });

  it('复制只报告动作，不改变态度也不打开结果中心', async () => {
    const user = userEvent.setup();
    const { onOpen, onRate } = renderCard();

    await user.click(screen.getByRole('button', { name: '复制文案' }));

    expect(onRate.mock.calls).toEqual([
      [
        {
          action: 'copy',
          idempotencyKey: expect.any(String),
          previousVerdict: null,
          nextVerdict: null,
        },
      ],
    ]);
    expect(screen.getByRole('button', { name: '这一版好用' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('没有确认交付版本时不出评价条', () => {
    renderCard({ revision: null });

    expect(screen.queryByRole('group', { name: '对这一版的评价' })).toBeNull();
  });
});

describe('成品卡后续动作 chip', () => {
  it('独立成组，出该 lens 的固定集合原文', () => {
    renderCard();

    const group = screen.getByRole('group', { name: '接下来还能做的' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['换成深色背景', '加上开业日期', '再出一版横版的']);
    // 与评价条是两组：一组说这一版怎么样，一组说下一版做什么。
    expect(group).not.toBe(ratingGroup());
  });

  it('点击只把整句交出去预填，既不提交也不打开结果中心', async () => {
    const user = userEvent.setup();
    const { onFollowUp, onOpen, onRate, onSubmit } = renderCard();

    const chip = screen.getByRole('button', { name: '换成深色背景' });
    expect(chip).toHaveAttribute('type', 'button');

    await user.click(chip);

    // 交出去的是整句 intent，不是 chip 上省了主语的 label。
    expect(onFollowUp.mock.calls).toEqual([
      [
        {
          id: 'dark_background',
          intent: '这版底色换成深色的，其他都不动',
          label: '换成深色背景',
        },
      ],
    ]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRate).not.toHaveBeenCalled();
  });

  it('已经成立的动作不再问一遍', () => {
    renderCard({ aspectRatio: '16:9' });

    const group = screen.getByRole('group', { name: '接下来还能做的' });
    expect(within(group).queryByText('再出一版横版的')).toBeNull();
    expect(within(group).getByText('换成深色背景')).toBeInTheDocument();
    expect(within(group).getByText('加上开业日期')).toBeInTheDocument();
  });

  it('没有创作类型时整组不出，不猜一档给商家', () => {
    renderCard({ lensId: undefined });

    expect(screen.queryByRole('group', { name: '接下来还能做的' })).toBeNull();
  });

  it('每档剔除后都还剩至少两条', () => {
    // D-164⑤「2–3 个」：剔到只剩一条时 listDeliveryFollowUps 会整组清空，宁可
    // 没有，也不出一个孤零零的 chip 让它看起来像唯一正解。这条守着它的前置
    // 条件——哪一档被改到剔除后只剩一条，先在这里红，好过在商家面前静默消失。
    for (const lensId of creationLensIds) {
      for (const ratio of [undefined, '16:9', '9:16', '3:4', '1:1']) {
        expect(
          listDeliveryFollowUps(lensId, ratio).length
        ).toBeGreaterThanOrEqual(DELIVERY_FOLLOWUP_MIN_VISIBLE);
      }
    }
  });
});
