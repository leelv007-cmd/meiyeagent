import type { HotTopicOpportunityCard } from '@meiye/contracts';
import { useId } from 'react';

import { Badge } from '@/components/ui/badge';
import { getLocale } from '@/lib/locale';
import {
  hot_topic_store_asset_reference,
  hot_topic_store_fact_reference,
  hot_topic_store_reference,
  hot_topic_store_service_area,
} from '@/locale/paraglide/messages';

const INTERNAL_REGION_PATTERN =
  /^(?:(?:store|workspace|ws)[_:-][a-z0-9][a-z0-9_-]{2,}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/iu;
const STORE_FACT_REFERENCE_PATTERN = /^store_fact:[a-z0-9][a-z0-9._-]*:\d+$/iu;
const ASSET_REFERENCE_PATTERN = /^asset:[a-z0-9][a-z0-9._-]*$/iu;
const INTERNAL_REFERENCE_PATTERN = /^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9._:-]*$/iu;

const COPY = {
  zh: {
    title: '热点机会卡',
    status: {
      active: '进行中',
      expired: '已失效',
      evergreen_fallback: '常青降级',
    },
    source: '来源',
    sourceType: {
      user_link: '用户链接',
      user_screenshot: '用户截图',
      user_text_with_source: '带来源文本',
      evergreen_fallback: '常青内容',
    },
    capturedAt: '采集时间',
    expiresAt: '有效至',
    platforms: '适用平台',
    region: '地域范围',
    targetAudience: '目标受众',
    matchedStoreReferences: '匹配的本店事实与素材',
    relevanceExplanation: '为什么与本店相关',
    reusableMechanism: '建议角度',
    expectedAction: '预期承接动作',
    evergreenFallback: '失效后方案',
    platform: {
      xiaohongshu: '小红书',
      douyin: '抖音',
      video_account: '视频号',
    },
  },
  en: {
    title: 'Opportunity card',
    status: {
      active: 'Active',
      expired: 'Expired',
      evergreen_fallback: 'Evergreen fallback',
    },
    source: 'Source',
    sourceType: {
      user_link: 'User link',
      user_screenshot: 'User screenshot',
      user_text_with_source: 'Sourced user text',
      evergreen_fallback: 'Evergreen content',
    },
    capturedAt: 'Captured at',
    expiresAt: 'Expires at',
    platforms: 'Platforms',
    region: 'Region',
    targetAudience: 'Target audience',
    matchedStoreReferences: 'Matched store facts and assets',
    relevanceExplanation: 'Why it fits this store',
    reusableMechanism: 'Suggested angle',
    expectedAction: 'Expected action',
    evergreenFallback: 'Fallback after expiry',
    platform: {
      xiaohongshu: 'Xiaohongshu',
      douyin: 'Douyin',
      video_account: 'WeChat Channels',
    },
  },
} as const;

export function HotTopicOpportunityCardView({
  opportunity,
  presentation = 'detail',
}: {
  opportunity?: HotTopicOpportunityCard;
  presentation?: 'compact' | 'detail';
}) {
  const headingId = useId();
  if (!opportunity) return null;
  const copy = COPY[getLocale()];
  const source = /^https?:\/\//iu.test(opportunity.source) ? (
    <a
      className="break-all underline underline-offset-4"
      href={opportunity.source}
      rel="noreferrer"
      target="_blank"
    >
      {opportunity.source}
    </a>
  ) : (
    opportunity.source
  );

  if (presentation === 'compact') {
    return (
      <section
        aria-labelledby={headingId}
        className="space-y-3 rounded-xl border border-primary/20 bg-surface-2 p-3"
        data-presentation="compact"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium" id={headingId}>
            {copy.title}
          </h4>
          <Badge
            data-opportunity-status={opportunity.status}
            variant="secondary"
          >
            {copy.status[opportunity.status]}
          </Badge>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <OpportunityField label={copy.source}>{source}</OpportunityField>
          <OpportunityField label={copy.expiresAt}>
            {displayTime(opportunity.expiresAt)}
          </OpportunityField>
          <OpportunityField label={copy.relevanceExplanation}>
            {opportunity.relevanceExplanation}
          </OpportunityField>
          <OpportunityField label={copy.expectedAction}>
            {opportunity.expectedAction}
          </OpportunityField>
        </dl>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-md border border-primary/20 bg-surface-2 p-4 xl:col-span-2"
      data-presentation="detail"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium" id={headingId}>
          {copy.title}
        </h3>
        <Badge
          data-opportunity-status={opportunity.status}
          variant={opportunity.status === 'active' ? 'secondary' : 'outline'}
        >
          {copy.status[opportunity.status]}
        </Badge>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <OpportunityField label={copy.source}>
          {source} · {copy.sourceType[opportunity.sourceType]}
        </OpportunityField>
        <OpportunityField label={copy.platforms}>
          {opportunity.platforms
            .map((platform) => copy.platform[platform])
            .join(' · ')}
        </OpportunityField>
        <OpportunityField label={copy.capturedAt}>
          {displayTime(opportunity.capturedAt)}
        </OpportunityField>
        <OpportunityField label={copy.expiresAt}>
          {displayTime(opportunity.expiresAt)}
        </OpportunityField>
        <OpportunityField label={copy.region}>
          {merchantRegion(opportunity.region)}
        </OpportunityField>
        <OpportunityField label={copy.targetAudience}>
          {opportunity.targetAudience}
        </OpportunityField>
        <OpportunityField label={copy.matchedStoreReferences}>
          <span className="flex flex-wrap gap-1.5">
            {opportunity.matchedStoreReferences.map((reference) => (
              <Badge
                className="h-auto break-all"
                key={reference}
                variant="outline"
              >
                {merchantReference(reference)}
              </Badge>
            ))}
          </span>
        </OpportunityField>
        <OpportunityField label={copy.relevanceExplanation}>
          {opportunity.relevanceExplanation}
        </OpportunityField>
        <OpportunityField label={copy.reusableMechanism}>
          {opportunity.reusableMechanism}
        </OpportunityField>
        <OpportunityField label={copy.expectedAction}>
          {opportunity.expectedAction}
        </OpportunityField>
        <OpportunityField label={copy.evergreenFallback}>
          {opportunity.evergreenFallback}
        </OpportunityField>
      </dl>
    </section>
  );
}

function OpportunityField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function displayTime(timestamp: string) {
  return timestamp.slice(0, 16).replace('T', ' ');
}

function merchantRegion(region: string) {
  const normalized = region.trim();
  return normalized && !INTERNAL_REGION_PATTERN.test(normalized)
    ? normalized
    : hot_topic_store_service_area();
}

function merchantReference(reference: string) {
  if (STORE_FACT_REFERENCE_PATTERN.test(reference)) {
    return hot_topic_store_fact_reference();
  }
  if (ASSET_REFERENCE_PATTERN.test(reference)) {
    return hot_topic_store_asset_reference();
  }
  return INTERNAL_REFERENCE_PATTERN.test(reference)
    ? hot_topic_store_reference()
    : reference;
}
