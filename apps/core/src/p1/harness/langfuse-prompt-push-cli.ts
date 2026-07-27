import {
  HARNESS_BUILTIN_PROMPTS,
  HARNESS_LANGFUSE_PROMPT_NAMES,
} from './langfuse-prompts.js';

const args = new Set(process.argv.slice(2));
const label = valueAfter('--label') ?? process.env.LANGFUSE_PROMPT_LABEL ?? 'production';
const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();
const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();

if (!label.trim()) throw new Error('--label must not be empty.');

const entries = Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES) as Array<
  [keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES, string]
>;
if (args.has('--dry-run')) {
  for (const [key, name] of entries) {
    console.log(`${key}\t${name}\tlabel=${label}`);
  }
  process.exit(0);
}
if (!baseUrl || !publicKey || !secretKey) {
  throw new Error(
    'LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY are required.',
  );
}

const auth = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
for (const [key, name] of entries) {
  const response = await fetch(
    `${baseUrl.replace(/\/$/u, '')}/api/public/v2/prompts`,
    {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name,
        type: 'text',
        prompt: HARNESS_BUILTIN_PROMPTS[key],
        labels: [label],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Langfuse prompt push failed for ${name}: HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const version = typeof body.version === 'number' ? body.version : 'unknown';
  console.log(`${key}\t${name}\tversion=${version}\tlabel=${label}`);
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
