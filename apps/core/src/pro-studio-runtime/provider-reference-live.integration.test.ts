import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createTuziProductionTransportFetch } from '../p1/model-supply/tuzi-media-adapter.js';

const enabled = process.env.RUN_LIVE_PROVIDER_REFERENCE_PROBE === '1';
const requiredNames = [
  'TUZI_MEDIA_API_KEY',
  'TUZI_MEDIA_BASE_URL',
  'TUZI_GPT_IMAGE_2_MODEL',
  'PROVIDER_REFERENCE_PROBE_CORRELATION_ID',
] as const;
const missing = requiredNames.filter((name) => !process.env[name]?.trim());

function required(name: (typeof requiredNames)[number]) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live provider reference probe.`);
  return value;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, '');
}

function providerErrorCode(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const error =
    root.error && typeof root.error === 'object' && !Array.isArray(root.error)
      ? (root.error as Record<string, unknown>)
      : root;
  return typeof error.code === 'string' ? error.code : null;
}

test(
  'live Tuzi Seedream accepts an owned reference through the production multipart transport',
  {
    skip: !enabled
      ? 'Set RUN_LIVE_PROVIDER_REFERENCE_PROBE=1 because this probe may spend one image generation.'
      : missing.length > 0
        ? `Missing live provider reference variables: ${missing.join(', ')}`
        : false,
    timeout: 2 * 60_000,
  },
  async () => {
    const correlationId = required('PROVIDER_REFERENCE_PROBE_CORRELATION_ID');
    const model = required('TUZI_GPT_IMAGE_2_MODEL');
    const referenceBytes = await sharp({
      create: {
        background: { alpha: 1, b: 230, g: 238, r: 245 },
        channels: 4,
        height: 512,
        width: 512,
      },
    })
      .png()
      .toBuffer();
    const providerReadableUrl = `data:image/png;base64,${referenceBytes.toString('base64')}`;
    const startedAt = new Date().toISOString();
    const productionTransport = createTuziProductionTransportFetch({
      apiKey: required('TUZI_MEDIA_API_KEY'),
    });
    const response = await productionTransport(
      `${trimTrailingSlash(required('TUZI_MEDIA_BASE_URL'))}/images/generations`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${required('TUZI_MEDIA_API_KEY')}`,
          'content-type': 'application/json',
          'x-client-request-id': correlationId,
        },
        body: JSON.stringify({
          image: [providerReadableUrl],
          model,
          n: 1,
          prompt:
            'Keep the simple centered composition and change the background to warm beige. No people, logo, or text.',
          response_format: 'url',
          size: '2048x2048',
        }),
      },
    );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const code = providerErrorCode(body);
    const completedAt = new Date().toISOString();
    console.log(
      JSON.stringify({
        acceptance: response.ok ? 'accepted' : 'rejected',
        completedAt,
        correlationId,
        httpStatus: response.status,
        model,
        operation: 'image.edit',
        provider: 'tuzi-seedream-relay',
        providerErrorCode: code,
        referenceBytes: referenceBytes.byteLength,
        referenceTransport: 'multipart_upload_from_owned_data_url',
        startedAt,
      }),
    );

    assert.equal(
      response.ok,
      true,
      `Provider rejected the production multipart reference transport with HTTP ${response.status}${code ? ` (${code})` : ''}.`,
    );
  },
);
