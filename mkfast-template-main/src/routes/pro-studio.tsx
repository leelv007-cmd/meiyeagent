import { authRouteMiddleware } from '@/middlewares/auth-middleware';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

type ProStudioEntry =
  | {
      activatedAt: string;
      launchUrl: string;
      offerId: string;
      status: 'active';
    }
  | {
      launchUrl: string;
      offer: {
        canPurchase: boolean;
        demoUrl: string;
        description: string;
        id: string;
        priceLabel: string;
        purchasePath: string;
        purchaseReason?:
          | 'activation_pending'
          | 'already_purchased'
          | 'owner_required'
          | 'unavailable';
      };
      status: 'locked';
    };

export const Route = createFileRoute('/pro-studio')({
  ssr: false,
  component: ProStudioEntryPage,
  server: { middleware: [authRouteMiddleware] },
});

function ProStudioEntryPage() {
  const [entry, setEntry] = useState<ProStudioEntry | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const waitingForPayment =
      new URLSearchParams(window.location.search).get('checkout') === 'success';
    const loadEntry = () => {
      fetch('/api/pro-studio/entry', { credentials: 'same-origin' })
        .then(async (response) => {
          if (!response.ok) throw new Error('入口状态加载失败，请稍后重试。');
          return (await response.json()) as ProStudioEntry;
        })
        .then((next) => {
          setEntry(next);
          attempts += 1;
          if (waitingForPayment && next.status === 'locked' && attempts < 30) {
            timeout = setTimeout(loadEntry, 1_000);
          }
        })
        .catch((reason: unknown) =>
          setError(
            reason instanceof Error ? reason.message : '入口状态加载失败。'
          )
        );
    };
    loadEntry();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  return (
    <main className="meiye-pro-studio px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <a
          className="text-sm text-[oklch(0.72_0.01_90)] transition-colors hover:text-[oklch(0.95_0.01_90)]"
          href="/dashboard"
        >
          ← 返回主产品
        </a>
        <section className="mt-12 grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spark-wash)] px-2 py-0.5 text-xs font-medium text-[var(--spark-deep)]">
              <span aria-hidden="true">✦</span>
              高阶画布
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              把复杂创作过程留在一张可恢复的高阶画布上
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[oklch(0.72_0.01_90)]">
              图片、文本、视频与音频任务按工程恢复；Agent
              改动需要先看计划、再确认、最后执行。
            </p>
          </div>
          <aside className="rounded-3xl border border-[oklch(1_0_0_/_0.08)] bg-[oklch(0.2_0.012_260)] p-7 shadow-[0_12px_40px_oklch(0_0_0_/_0.35)]">
            {!entry && !error ? (
              <p className="text-[oklch(0.72_0.01_90)]">正在读取工作区权益…</p>
            ) : null}
            {error ? (
              <p className="text-[oklch(0.72_0.12_25)]" role="alert">
                {error}
              </p>
            ) : null}
            {entry?.status === 'active' ? (
              <>
                <p className="text-sm font-medium text-[oklch(0.72_0.12_150)]">
                  工作区已解锁
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  继续进入 Pro Studio
                </h2>
                <form action={entry.launchUrl} method="get" target="_self">
                  <input name="returnTo" type="hidden" value="/pro-studio" />
                  <input name="locale" type="hidden" value="zh-CN" />
                  <input name="theme" type="hidden" value="dark" />
                  <button
                    className="mt-6 w-full rounded-full bg-[oklch(0.95_0.01_90)] px-5 py-3 font-semibold text-[oklch(0.16_0.01_260)] transition-colors hover:bg-[oklch(1_0_0)]"
                    type="submit"
                  >
                    一键进入
                  </button>
                </form>
              </>
            ) : null}
            {entry?.status === 'locked' ? (
              <>
                <p className="inline-flex items-center gap-1.5 rounded-md bg-[var(--spark-wash)] px-2 py-0.5 text-xs font-medium text-[var(--spark-deep)]">
                  <span aria-hidden="true">✦</span>
                  独立加购项
                </p>
                <h2 className="mt-2 text-3xl font-semibold">
                  {entry.offer.priceLabel}
                </h2>
                <p className="mt-4 leading-7 text-[oklch(0.72_0.01_90)]">
                  {entry.offer.description}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    className="rounded-full border border-[oklch(1_0_0_/_0.12)] px-5 py-3 font-semibold text-[oklch(0.95_0.01_90)] transition-colors hover:bg-[oklch(1_0_0_/_0.04)]"
                    href={entry.offer.demoUrl}
                  >
                    查看演示
                  </a>
                  {entry.offer.canPurchase ? (
                    <form action={entry.offer.purchasePath} method="post">
                      <button
                        className="rounded-full bg-[oklch(0.95_0.01_90)] px-5 py-3 font-semibold text-[oklch(0.16_0.01_260)] transition-colors hover:bg-[oklch(1_0_0)]"
                        type="submit"
                      >
                        Owner 立即购买
                      </button>
                    </form>
                  ) : (
                    <span className="self-center text-sm text-[oklch(0.58_0.01_90)]">
                      {entry.offer.purchaseReason === 'activation_pending'
                        ? '付款已确认，正在激活并将自动重试'
                        : entry.offer.purchaseReason === 'already_purchased'
                          ? '已购买，权益正在同步'
                          : entry.offer.purchaseReason === 'unavailable'
                            ? '购买配置暂不可用'
                            : '请联系工作区 Owner 购买'}
                    </span>
                  )}
                </div>
              </>
            ) : null}
          </aside>
        </section>
        <section
          className="mt-16 grid gap-4 border-t border-[oklch(1_0_0_/_0.08)] pt-10 sm:grid-cols-3"
          id="demo"
        >
          {[
            ['可恢复工程', '草稿、检查点与生成任务都按工作区工程恢复。'],
            ['生成主链', '先报价、再提交；供应商未激活的能力会明确禁用。'],
            ['受控 Agent', '计划、确认与应用分离，全部改动进入工程审计。'],
          ].map(([title, description]) => (
            <article
              className="rounded-2xl border border-[oklch(1_0_0_/_0.06)] bg-[oklch(0.18_0.01_260)] p-6"
              key={title}
            >
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[oklch(0.68_0.01_90)]">
                {description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
