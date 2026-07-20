/**
 * ═══════════════════════════════════════════════════════════════════
 * PROTOTYPE — THROWAWAY CODE. DO NOT SHIP. DO NOT IMPORT FROM HERE.
 * ═══════════════════════════════════════════════════════════════════
 *
 * 4 个「宣发经营 Agent 首屏」结构变体，回答的问题是：
 * “首页三件事（今天值得发什么 / 一句话下任务 / 五类入口）+ 成品优先，
 *   信息层级到底以什么为主轴？”
 *
 * 参考: docs/design/beauty-marketing-agent-product-design-2026-07-17.md
 * 视觉: DESIGN.md「门店橱窗」——氛围层 + 玻璃 + 白瓷 + 玫瑰金火花
 *
 * 变体（?variant= 切换，底部浮动条或 ←/→ 键循环）:
 *   A 机会流       —— 「今天值得发什么」垂直流优先，Composer 沉底
 *   B Composer 主轴 —— 一句话下任务居中，机会与入口围绕输入
 *   C 橱窗成品墙    —— 主推荐成品全出血占屏，控件全部浮在成品上
 *   D 经营循环面板  —— 今天/进行中/已发布/沉淀 四段循环一屏可见
 *
 * 运行: pnpm --filter @meiye/web dev → http://localhost:3000/prototype-marketing-home
 * 纯 mock 数据，无任何真实读写；production 构建下整页隐藏。
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';

type VariantKey = 'A' | 'B' | 'C' | 'D';

const VARIANTS: { key: VariantKey; name: string }[] = [
  { key: 'A', name: '机会流' },
  { key: 'B', name: 'Composer 主轴' },
  { key: 'C', name: '橱窗成品墙' },
  { key: 'D', name: '经营循环面板' },
];

export const Route = createFileRoute('/prototype-marketing-home')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { variant: VariantKey } => ({
    variant: VARIANTS.some((v) => v.key === search.variant)
      ? (search.variant as VariantKey)
      : 'A',
  }),
  component: PrototypeMarketingHome,
});

/* ── mock 数据（全部虚构，仅供结构评审） ─────────────────────────── */

const mock = {
  store: '隅屿 · 美甲美睫（静安寺店）',
  operator: '阿雅',
  greeting: '嗨，阿雅，今天想发点什么？',
  entries: ['日常曝光', '跟热点', '做 IP', '活动 · 团购', '宣传物料'],
  opportunities: [
    {
      id: 'opp-1',
      tag: '节点机会',
      title: '七夕将至 · 情侣款美甲预约窗口',
      source: '抖音活动「七夕心动企划」',
      collected: '今天 09:20 采集',
      expiry: '07-31 过期',
      relevance: '匹配本店「星河碎钻款」+ 7 月新客券',
      platforms: '小红书 · 抖音',
    },
    {
      id: 'opp-2',
      tag: '同城搜索',
      title: '静安「日常通勤美甲」搜索连续两周上升',
      source: '小红书搜索结构',
      collected: '今天 09:20 采集',
      expiry: '常青 · 相关性中',
      relevance: '匹配「奶杏拿铁色」系列 + 通勤客群',
      platforms: '小红书',
    },
    {
      id: 'opp-3',
      tag: '本店信号',
      title: '周四下午空档率偏高，适合空档填充促销',
      source: '门店档期（店内记录）',
      collected: '本周复盘',
      expiry: '每周滚动',
      relevance: '可绑「周四限定 8 折」承接',
      platforms: '小红书 · 朋友圈',
    },
  ],
  pkg: {
    title: '七夕 · 星河碎钻款 双人预约企划',
    whyNow: '七夕前 14 天是情侣款预约高峰，抖音活动流量窗口至 07-31',
    whyUs: '用了本店「星河碎钻款」6.28 店拍素材 + 7 月价目表 + 主理人身份',
    identity: '主理人阿雅 · 亲历口吻',
    cta: '私信领「双人 30 元券」→ 预约到店',
    deliverables: ['小红书图文 · 封面+4 图+正文', '抖音口播脚本 15s', '价格卡 1080×1440', '朋友圈海报'],
    facts: ['价格 ¥128 · 来源 2026-07 价目表', '活动有效期至 07-31', '素材已授权 · 店拍 06-28', 'AIGC 标识将烧录'],
    quickEdits: ['更像主理人本人', '少一点促销', '换一组素材', '换成抖音版', '做成海报', '做同款换项目'],
    alternates: ['专业科普型 · 「甲面护理冷知识」', '体验种草型 · 「到店 45 分钟记录」'],
  },
  inbox: [
    { state: '生成中', label: '抖音口播视频渲染 62%', tone: 'progress' },
    { state: '需要你选', label: '价格卡两个排版方向', tone: 'warning' },
    { state: '已完成', label: '「招牌镜面甲」图文已入库', tone: 'success' },
  ],
  published: [
    { title: '招牌镜面甲 · 图文', when: '周一发布', ladder: '已发布 → 获得注意 → 发生咨询', signals: '私信 ×3 · 预约 ×1' },
    { title: '7 月新客券 · 价格卡', when: '上周五导出', ladder: '已发布 → 获得注意', signals: '加微 ×2' },
  ],
  reuse: [
    { title: '「招牌镜面甲」做同款 → 换「猫眼胶」', hint: '沿用封面结构与口吻' },
    { title: '「主理人小课堂」系列续写 · 第 4 期', hint: '上期采用未修改' },
  ],
};

/* ── 共用小件（仅原型内部共享，变体各自拥有布局） ─────────────────── */

function Chip({ children, spark }: { children: ReactNode; spark?: boolean }) {
  return (
    <span
      className={
        spark
          ? 'inline-flex items-center rounded-[8px] bg-[oklch(0.95_0.025_18)] px-2 py-0.5 text-xs font-medium text-[oklch(0.45_0.1_18)]'
          : 'inline-flex items-center rounded-full bg-[var(--glass-50)] px-3 py-1 text-xs text-[var(--ink-60)] backdrop-blur'
      }
    >
      {children}
    </span>
  );
}

function InkButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex h-11 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-medium text-white transition hover:bg-[oklch(0.32_0_0)]"
    >
      {children}
    </button>
  );
}

function GlassButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center rounded-full bg-[var(--glass-50)] px-4 text-sm text-[var(--ink-90)] backdrop-blur transition hover:bg-[var(--glass-80)]"
    >
      {children}
    </button>
  );
}

/** 氛围层：真实产品用商家自己的作品影像；原型用渐变占位 */
function Ambient({ strong }: { strong?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: strong
            ? 'linear-gradient(160deg, oklch(0.92 0.04 18) 0%, oklch(0.9 0.02 60) 35%, oklch(0.93 0.03 300) 70%, oklch(0.96 0.01 18) 100%)'
            : 'linear-gradient(165deg, oklch(0.97 0.015 18) 0%, oklch(0.965 0 0) 55%, oklch(0.96 0.02 60) 100%)',
        }}
      />
      <div className="absolute -top-24 right-[-10%] h-96 w-96 rounded-full bg-[oklch(0.88_0.06_18/0.5)] blur-3xl" />
      <div className="absolute bottom-[-20%] left-[-5%] h-80 w-80 rounded-full bg-[oklch(0.9_0.04_60/0.4)] blur-3xl" />
    </div>
  );
}

/* ══ Variant A ── 机会流：今天值得发什么优先，Composer 沉底 ═════════ */

function VariantA() {
  const main = mock.opportunities[0];
  return (
    <div className="relative min-h-svh">
      <Ambient />
      <div className="relative mx-auto flex min-h-svh w-full max-w-3xl flex-col px-4 pb-32 pt-10">
        <p className="text-xs font-medium tracking-wide text-[var(--ink-40)]">{mock.store}</p>
        <h1 className="mt-2 text-[clamp(1.6rem,3vw,2.4rem)] font-extralight leading-tight text-[var(--ink-90)]">
          今天值得发什么
        </h1>

        {/* 主推荐大卡：机会 + 完整成品预览一体 */}
        <section className="mt-6 overflow-hidden rounded-[32px] bg-white shadow-[0_2px_20px_oklch(0_0_0/0.05)]">
          <div className="flex items-center gap-2 px-6 pt-5">
            <Chip spark>AI 主推荐</Chip>
            <Chip>{main.tag}</Chip>
            <Chip>{main.expiry}</Chip>
          </div>
          <div className="px-6 pt-3">
            <h2 className="text-xl font-semibold text-[var(--ink-90)]">{mock.pkg.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-60)]">
              <span className="font-medium text-[var(--ink-90)]">为什么是现在：</span>
              {mock.pkg.whyNow}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--ink-60)]">
              <span className="font-medium text-[var(--ink-90)]">为什么是本店：</span>
              {mock.pkg.whyUs}
            </p>
          </div>
          {/* 成品预览条 */}
          <div className="mt-4 flex gap-3 overflow-x-auto px-6">
            {mock.pkg.deliverables.map((d) => (
              <div
                key={d}
                className="flex h-36 w-28 shrink-0 items-end rounded-[16px] bg-[oklch(0.93_0.03_18)] p-2 text-xs leading-snug text-[var(--ink-60)]"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 px-6">
            {mock.pkg.facts.map((f) => (
              <Chip key={f}>{f}</Chip>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-[oklch(0_0_0/0.04)] px-6 py-4">
            <div className="text-sm text-[var(--ink-60)]">
              {mock.pkg.identity} · {mock.pkg.cta}
            </div>
            <div className="flex gap-2">
              <GlassButton>看两个备选</GlassButton>
              <InkButton>就做这条</InkButton>
            </div>
          </div>
        </section>

        {/* 次级机会流 */}
        <div className="mt-8 flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--ink-40)]">其他机会</p>
          <div className="flex gap-1.5">
            {mock.entries.map((e) => (
              <Chip key={e}>{e}</Chip>
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-3">
          {mock.opportunities.slice(1).map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between rounded-[20px] bg-[var(--glass-80)] px-5 py-4 backdrop-blur"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Chip>{o.tag}</Chip>
                  <span className="text-xs text-[var(--ink-40)]">
                    {o.source} · {o.expiry}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium text-[var(--ink-90)]">{o.title}</p>
                <p className="mt-0.5 text-xs text-[var(--ink-60)]">{o.relevance}</p>
              </div>
              <GlassButton>生成成品</GlassButton>
            </div>
          ))}
        </div>
      </div>

      {/* Composer 沉底胶囊 */}
      <div className="fixed inset-x-0 bottom-16 z-10 mx-auto w-full max-w-2xl px-4">
        <div className="flex items-center gap-3 rounded-full bg-white/90 py-2 pl-6 pr-2 shadow-[0_8px_30px_oklch(0_0_0/0.08)] backdrop-blur-xl">
          <input
            className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-40)]"
            placeholder="一句话下任务：把新团购做一套能发的…"
          />
          <InkButton>开始</InkButton>
        </div>
      </div>
    </div>
  );
}

/* ══ Variant B ── Composer 主轴：输入居中，机会与入口围绕输入 ═══════ */

function VariantB() {
  return (
    <div className="relative min-h-svh">
      <Ambient />
      <div className="relative mx-auto flex min-h-svh w-full max-w-4xl flex-col items-center px-4 pt-[16vh]">
        <p className="text-xs font-medium tracking-wide text-[var(--ink-40)]">{mock.store}</p>
        <h1 className="mt-3 text-center text-[clamp(1.75rem,3.5vw,2.75rem)] font-extralight text-[var(--ink-90)]">
          {mock.greeting}
        </h1>

        {/* 白瓷 Composer 大卡 */}
        <div className="mt-8 w-full max-w-2xl rounded-[32px] bg-white p-3 shadow-[0_2px_20px_oklch(0_0_0/0.06)]">
          <textarea
            rows={3}
            className="w-full resize-none rounded-[20px] bg-transparent px-4 pt-3 text-[15px] leading-relaxed outline-none placeholder:text-[var(--ink-40)]"
            placeholder={'把这个新团购做一套能发的\n用小林的口吻讲这个热点\n粘贴链接 / 上传素材也可以直接开始'}
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <div className="flex gap-1.5">
              {mock.entries.map((e) => (
                <Chip key={e}>{e}</Chip>
              ))}
            </div>
            <InkButton>生成成品</InkButton>
          </div>
        </div>

        {/* 机会横排：Composer 之下的建议，不抢输入的主轴 */}
        <div className="mt-10 w-full">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-[var(--ink-60)]">
              <span className="mr-1.5 rounded-[8px] bg-[oklch(0.95_0.025_18)] px-1.5 py-0.5 text-xs text-[oklch(0.45_0.1_18)]">
                AI
              </span>
              今天值得发什么
            </p>
            <span className="text-xs text-[var(--ink-40)]">来源与过期时间可解释</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {mock.opportunities.map((o, i) => (
              <div key={o.id} className="flex flex-col rounded-[20px] bg-[var(--glass-80)] p-4 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Chip>{o.tag}</Chip>
                  {i === 0 && <Chip spark>主推荐</Chip>}
                </div>
                <p className="mt-2 flex-1 text-sm font-medium leading-snug text-[var(--ink-90)]">{o.title}</p>
                <p className="mt-1 text-xs text-[var(--ink-40)]">
                  {o.source} · {o.expiry}
                </p>
                <p className="mt-2 text-xs text-[var(--ink-60)]">{o.relevance}</p>
                <div className="mt-3">
                  <GlassButton>{i === 0 ? '看完整成品' : '生成'}</GlassButton>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-10 pb-24 text-xs text-[var(--ink-40)]">
          进行中 2 项 · 本周已发布 2 条 · 做同款候选 2 个 —— 在收件箱查看
        </p>
      </div>
    </div>
  );
}

/* ══ Variant C ── 橱窗成品墙：主推荐成品全出血，控件浮在作品上 ══════ */

function VariantC() {
  return (
    <div className="relative min-h-svh overflow-hidden">
      {/* 成品即氛围：全出血主推荐预览（原型以渐变+大字占位） */}
      <Ambient strong />
      <div aria-hidden className="absolute inset-0 flex items-center justify-center">
        <p className="max-w-xl text-center text-[clamp(2rem,5vw,3.5rem)] font-extralight leading-tight text-[oklch(0.35_0.05_18/0.55)]">
          星河碎钻款
          <br />
          双人预约企划
          <span className="mt-3 block text-base font-normal text-[oklch(0.35_0.05_18/0.4)]">
            —— 小红书封面成品预览占位 ——
          </span>
        </p>
      </div>

      {/* 顶部薄条：店名 + 机会 ticker */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-4 px-6 py-4">
        <span className="rounded-full bg-[var(--glass-80)] px-4 py-1.5 text-xs font-medium text-[var(--ink-90)] backdrop-blur">
          {mock.store}
        </span>
        <div className="flex min-w-0 gap-2 overflow-x-auto">
          {mock.opportunities.map((o, i) => (
            <span
              key={o.id}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs backdrop-blur ${
                i === 0 ? 'bg-[var(--ink)] text-white' : 'bg-[var(--glass-50)] text-[var(--ink-60)]'
              }`}
            >
              {o.title}
            </span>
          ))}
        </div>
      </div>

      {/* 左下玻璃信息组：为什么发 / 谁在说 / 事实与权利 / CTA */}
      <div className="absolute bottom-24 left-6 max-w-md rounded-[24px] bg-[var(--glass-80)] p-5 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Chip spark>AI 主推荐</Chip>
          <Chip>07-31 过期</Chip>
        </div>
        <h2 className="mt-2 text-lg font-semibold text-[var(--ink-90)]">{mock.pkg.title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-60)]">{mock.pkg.whyNow}</p>
        <p className="mt-1 text-xs text-[var(--ink-60)]">
          {mock.pkg.identity} · {mock.pkg.cta}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mock.pkg.facts.map((f) => (
            <Chip key={f}>{f}</Chip>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <InkButton>就发这条</InkButton>
          <GlassButton>整套成品（4 件）</GlassButton>
        </div>
      </div>

      {/* 右侧竖排快捷纠偏 */}
      <div className="absolute bottom-24 right-6 flex flex-col items-end gap-2">
        {mock.pkg.quickEdits.map((q) => (
          <button
            key={q}
            type="button"
            className="rounded-full bg-[var(--glass-80)] px-4 py-2 text-xs text-[var(--ink-90)] backdrop-blur-xl transition hover:bg-white"
          >
            {q}
          </button>
        ))}
      </div>

      {/* 底部：Composer 唤起 + 五类入口 */}
      <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-2 px-6">
        <span className="rounded-full bg-white/90 py-2.5 pl-5 pr-3 text-sm text-[var(--ink-40)] shadow-[0_8px_30px_oklch(0_0_0/0.1)] backdrop-blur-xl">
          一句话下任务…
          <span className="ml-3 rounded-full bg-[var(--ink)] px-3 py-1 text-xs text-white">开始</span>
        </span>
        {mock.entries.map((e) => (
          <Chip key={e}>{e}</Chip>
        ))}
      </div>
    </div>
  );
}

/* ══ Variant D ── 经营循环面板：今天/进行中/已发布/沉淀 一屏循环 ════ */

function VariantD() {
  const toneCls: Record<string, string> = {
    progress: 'text-[oklch(0.5_0.19_262)]',
    warning: 'text-[oklch(0.55_0.13_85)]',
    success: 'text-[oklch(0.53_0.14_150)]',
  };
  return (
    <div className="relative min-h-svh">
      <Ambient />
      <div className="relative mx-auto min-h-svh w-full max-w-7xl px-6 pb-28 pt-8">
        {/* 顶条：问候 + Composer 同排 */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-[var(--ink-40)]">{mock.store}</p>
            <h1 className="mt-1 text-2xl font-extralight text-[var(--ink-90)]">{mock.greeting}</h1>
          </div>
          <div className="flex min-w-72 flex-1 items-center gap-2 rounded-full bg-white py-1.5 pl-5 pr-1.5 shadow-[0_2px_20px_oklch(0_0_0/0.05)] sm:max-w-md">
            <input
              className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ink-40)]"
              placeholder="一句话下任务…"
            />
            <InkButton>开始</InkButton>
          </div>
        </div>

        {/* 四段循环 */}
        <div className="mt-8 grid gap-4 lg:grid-cols-4">
          {/* 今天 */}
          <section className="rounded-[24px] bg-white p-5 shadow-[0_2px_20px_oklch(0_0_0/0.04)] lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--ink-90)]">今天 · 值得发</h2>
              <Chip spark>AI 主推荐</Chip>
            </div>
            <div className="mt-3 rounded-[16px] bg-[oklch(0.97_0.015_18)] p-4">
              <p className="text-base font-semibold text-[var(--ink-90)]">{mock.pkg.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-60)]">{mock.pkg.whyNow}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mock.pkg.facts.slice(0, 3).map((f) => (
                  <Chip key={f}>{f}</Chip>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <InkButton>就做这条</InkButton>
                <GlassButton>备选 ×2</GlassButton>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {mock.opportunities.slice(1).map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-[12px] px-2 py-1.5 hover:bg-[var(--glass-50)]">
                  <p className="text-xs text-[var(--ink-60)]">
                    <span className="font-medium text-[var(--ink-90)]">{o.tag}</span> · {o.title}
                  </p>
                  <span className="text-xs text-[var(--ink-40)]">{o.expiry}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-1.5 border-t border-[oklch(0_0_0/0.04)] pt-3">
              {mock.entries.map((e) => (
                <Chip key={e}>{e}</Chip>
              ))}
            </div>
          </section>

          {/* 进行中（异步收件箱） */}
          <section className="rounded-[24px] bg-[var(--glass-80)] p-5 backdrop-blur">
            <h2 className="text-sm font-semibold text-[var(--ink-90)]">进行中</h2>
            <div className="mt-3 space-y-3">
              {mock.inbox.map((t) => (
                <div key={t.label} className="rounded-[16px] bg-white/70 p-3">
                  <p className={`text-xs font-semibold ${toneCls[t.tone]}`}>{t.state}</p>
                  <p className="mt-0.5 text-sm text-[var(--ink-90)]">{t.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--ink-40)]">离开页面不丢任务，回来可继续</p>
          </section>

          {/* 已发布 + 沉淀 */}
          <section className="flex flex-col gap-4">
            <div className="rounded-[24px] bg-[var(--glass-80)] p-5 backdrop-blur">
              <h2 className="text-sm font-semibold text-[var(--ink-90)]">已发布 · 补一笔</h2>
              <div className="mt-3 space-y-3">
                {mock.published.map((p) => (
                  <div key={p.title} className="rounded-[16px] bg-white/70 p-3">
                    <p className="text-sm font-medium text-[var(--ink-90)]">{p.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-40)]">
                      {p.when} · {p.ladder}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip spark>{p.signals}</Chip>
                      {['私信', '加微', '预约', '买券', '到店'].map((s) => (
                        <Chip key={s}>+{s}</Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] bg-[var(--glass-80)] p-5 backdrop-blur">
              <h2 className="text-sm font-semibold text-[var(--ink-90)]">沉淀 · 做同款</h2>
              <div className="mt-3 space-y-2">
                {mock.reuse.map((r) => (
                  <div key={r.title} className="rounded-[12px] px-2 py-1.5 hover:bg-white/70">
                    <p className="text-sm text-[var(--ink-90)]">{r.title}</p>
                    <p className="text-xs text-[var(--ink-40)]">{r.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── 浮动切换条（评审工装，非设计的一部分） ───────────────────────── */

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const navigate = Route.useNavigate();
  const idx = VARIANTS.findIndex((v) => v.key === current);
  const go = (dir: 1 | -1) => {
    const next = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length];
    navigate({ search: { variant: next.key }, replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-dashed border-white/40 bg-neutral-900 px-2 py-1.5 text-white shadow-2xl">
      <button
        type="button"
        aria-label="上一个变体"
        onClick={() => go(-1)}
        className="rounded-full px-2.5 py-1 text-lg leading-none hover:bg-white/15"
      >
        ←
      </button>
      <span className="min-w-40 select-none text-center font-mono text-xs">
        PROTOTYPE {current} — {VARIANTS[idx].name}
      </span>
      <button
        type="button"
        aria-label="下一个变体"
        onClick={() => go(1)}
        className="rounded-full px-2.5 py-1 text-lg leading-none hover:bg-white/15"
      >
        →
      </button>
    </div>
  );
}

/* ── 页面 ─────────────────────────────────────────────────────────── */

function PrototypeMarketingHome() {
  const { variant } = Route.useSearch();

  if (import.meta.env.PROD) {
    return null; // 原型永不出现在 production 构建
  }

  return (
    <div className="meiye-product-shell min-h-svh bg-[var(--canvas,oklch(0.965_0_0))] [font-family:Inter,'HarmonyOS_Sans',MiSans,'PingFang_SC',sans-serif]">
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      {variant === 'D' && <VariantD />}
      <PrototypeSwitcher current={variant} />
    </div>
  );
}
