import { GoogleAnalytics } from './google-analytics';
import { PlausibleAnalytics } from './plausible-analytics';
import { UmamiAnalytics } from './umami-analytics';
import { WebVitalsReporter } from './web-vitals-reporter';
import { TelemetryReporter } from './telemetry-reporter';

/**
 * Renders all script-based analytics (only in production)
 */
export function Analytics() {
  return (
    <>
      {import.meta.env.PROD ? (
        <>
          <GoogleAnalytics />
          <UmamiAnalytics />
          <PlausibleAnalytics />
        </>
      ) : null}
      <TelemetryReporter />
      <WebVitalsReporter />
    </>
  );
}
