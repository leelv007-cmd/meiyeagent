import { registerTelemetry } from 'ai';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseVercelAiSdkIntegration } from '@langfuse/vercel-ai-sdk';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  langfuseTracingConfigFromEnv,
  maskLangfuseData,
} from './langfuse-config.js';

const config = langfuseTracingConfigFromEnv(process.env);

export const langfuseTracingEnabled = Boolean(config);

const langfuseSpanProcessor =
  config
    ? new LangfuseSpanProcessor({
        baseUrl: config.baseUrl,
        environment: config.environment,
        mask: ({ data }) => maskLangfuseData(data),
        publicKey: config.publicKey,
        secretKey: config.secretKey,
      })
    : undefined;

const langfuseSdk = langfuseSpanProcessor
  ? new NodeSDK({
      spanProcessors: [langfuseSpanProcessor],
    })
  : undefined;

if (langfuseSdk) {
  langfuseSdk.start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}

export async function flushLangfuseTracing() {
  await langfuseSpanProcessor?.forceFlush();
}

export async function shutdownLangfuseTracing() {
  await langfuseSdk?.shutdown();
}
