import { useEffect } from 'react';
import type { Metric } from 'web-vitals';

export type WebVitalName = 'CLS' | 'INP' | 'LCP';
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export interface WebVitalPayload {
  delta: number;
  device: 'desktop' | 'mobile';
  id: string;
  name: WebVitalName;
  rating: WebVitalRating;
  route: string;
  value: number;
}

type AnalyticsWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  plausible?: (
    event: string,
    options: { props: Record<string, string | number> }
  ) => void;
  umami?: {
    track: (event: string, data: Record<string, string | number>) => void;
  };
};

const GOOD_THRESHOLD: Record<WebVitalName, number> = {
  CLS: 0.1,
  INP: 200,
  LCP: 2_500,
};

const POOR_THRESHOLD: Record<WebVitalName, number> = {
  CLS: 0.25,
  INP: 500,
  LCP: 4_000,
};

export function normalizeRumRoute(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] || '/';
  return pathname
    .replace(
      /^\/dashboard\/(tasks|assets|content|sessions|works|jobs)\/[^/]+/,
      '/dashboard/$1/:id'
    )
    .replace(/^\/dashboard\/handoff\/[^/]+/, '/dashboard/handoff/:token');
}

export function webVitalRating(
  name: WebVitalName,
  value: number
): WebVitalRating {
  if (value <= GOOD_THRESHOLD[name]) return 'good';
  return value > POOR_THRESHOLD[name] ? 'poor' : 'needs-improvement';
}

export function buildWebVitalPayload({
  delta,
  id,
  name,
  pathname,
  value,
  viewportWidth,
}: {
  delta: number;
  id: string;
  name: WebVitalName;
  pathname: string;
  value: number;
  viewportWidth: number;
}): WebVitalPayload {
  const roundedValue = Math.round(value * 1_000) / 1_000;
  return {
    delta: Math.round(delta * 1_000) / 1_000,
    device: viewportWidth <= 767 ? 'mobile' : 'desktop',
    id,
    name,
    rating: webVitalRating(name, roundedValue),
    route: normalizeRumRoute(pathname),
    value: roundedValue,
  };
}

function reportWebVital(payload: WebVitalPayload) {
  const analytics = window as AnalyticsWindow;
  const fields = {
    device: payload.device,
    metric_delta: payload.delta,
    metric_id: payload.id,
    metric_name: payload.name,
    metric_rating: payload.rating,
    metric_value: payload.value,
    route: payload.route,
  };
  window.dispatchEvent(
    new CustomEvent<WebVitalPayload>('meiye:web-vital', { detail: payload })
  );
  analytics.gtag?.('event', 'web_vital', {
    ...fields,
    non_interaction: true,
    value: payload.delta,
  });
  analytics.plausible?.('Web Vital', { props: fields });
  analytics.umami?.track('web_vital', fields);
}

export function WebVitalsReporter() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const pathname = window.location.pathname;
    let cancelled = false;
    const report = ({ delta, id, name, value }: Metric) => {
      if (name !== 'CLS' && name !== 'INP' && name !== 'LCP') return;
      reportWebVital(
        buildWebVitalPayload({
          delta,
          id,
          name,
          pathname,
          value,
          viewportWidth: window.innerWidth,
        })
      );
    };
    void import('web-vitals').then(({ onCLS, onINP, onLCP }) => {
      if (cancelled) return;
      onCLS(report);
      onINP(report);
      onLCP(report);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
