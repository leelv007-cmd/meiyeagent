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
    <main className="min-h-svh bg-[#0c0d10] px-6 py-12 text-[#f5f2ec]">
      <div className="mx-auto max-w-5xl">
        <a
          className="text-sm text-[#b9b5ad] hover:text-white"
          href="/dashboard"
        >
          ← 返回主产品
        </a>
        <section className="mt-12 grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-sm font-bold tracking-[0.2em] text-[#d99a58] uppercase">
              Pro Studio
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              把复杂创作过程留在一张可恢复的高阶画布上
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#b9b5ad]">
              图片、文本、视频与音频任务按工程恢复；Agent
              改动需要先看计划、再确认、最后执行。
            </p>
          </div>
          <aside className="rounded-3xl border border-[#34363e] bg-[#15161b] p-7 shadow-2xl">
            {!entry && !error ? <p>正在读取工作区权益…</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {entry?.status === 'active' ? (
              <>
                <p className="text-sm text-[#8ed081]">工作区已解锁</p>
                <h2 className="mt-2 text-2xl font-semibold">
                  继续进入 Pro Studio
                </h2>
                <form action={entry.launchUrl} method="get" target="_self">
                  <input name="returnTo" type="hidden" value="/pro-studio" />
                  <input name="locale" type="hidden" value="zh-CN" />
                  <input name="theme" type="hidden" value="dark" />
                  <button
                    className="mt-6 w-full rounded-xl bg-[#efb66c] px-5 py-3 font-bold text-[#15110c]"
                    type="submit"
                  >
                    一键进入
                  </button>
                </form>
              </>
            ) : null}
            {entry?.status === 'locked' ? (
              <>
                <p className="text-sm text-[#d99a58]">独立加购项</p>
                <h2 className="mt-2 text-3xl font-semibold">
                  {entry.offer.priceLabel}
                </h2>
                <p className="mt-4 leading-7 text-[#aaa69e]">
                  {entry.offer.description}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    className="rounded-xl border border-[#4a4c55] px-5 py-3 font-semibold"
                    href={entry.offer.demoUrl}
                  >
                    查看演示
                  </a>
                  {entry.offer.canPurchase ? (
                    <form action={entry.offer.purchasePath} method="post">
                      <button
                        className="rounded-xl bg-[#efb66c] px-5 py-3 font-bold text-[#15110c]"
                        type="submit"
                      >
                        Owner 立即购买
                      </button>
                    </form>
                  ) : (
                    <span className="self-center text-sm text-[#85827d]">
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
          className="mt-16 grid gap-4 border-t border-[#2b2c31] pt-10 sm:grid-cols-3"
          id="demo"
        >
          {[
            ['可恢复工程', '草稿、检查点与生成任务都按工作区工程恢复。'],
            ['生成主链', '先报价、再提交；供应商未激活的能力会明确禁用。'],
            ['受控 Agent', '计划、确认与应用分离，全部改动进入工程审计。'],
          ].map(([title, description]) => (
            <article className="rounded-2xl bg-[#121318] p-6" key={title}>
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#9f9c96]">
                {description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
