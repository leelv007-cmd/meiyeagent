import {
  admin_skills_command_must_not_contain,
  admin_skills_skill_promptreference_must_use_resolvabl_505aceb4,
} from '@/locale/paraglide/messages';
const FORBIDDEN_SKILL_CONTENT_FIELDS = new Set(['content', 'fallbackContent']);
const PROMPT_FIELDS = new Set(['prompt', 'promptReference']);

export function assertReferenceOnlySkillPayload(value: unknown): void {
  visitPromptFields(value, (field, prompt) => {
    for (const key of Object.keys(prompt)) {
      if (FORBIDDEN_SKILL_CONTENT_FIELDS.has(key)) {
        throw new Error(admin_skills_command_must_not_contain({ key }));
      }
    }
    if (field === 'promptReference' && !isPinnedPromptReference(prompt)) {
      throw new Error(
        admin_skills_skill_promptreference_must_use_resolvabl_505aceb4()
      );
    }
  });
}

export function redactSkillCommandResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSkillCommandResult);
  }
  if (!isRecord(value)) return value;
  const legacyRevision = value.formatVersion === 1;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      legacyRevision && key === 'instruction'
        ? []
        : [
            [
              key,
              PROMPT_FIELDS.has(key) && isRecord(nested)
                ? redactPrompt(nested)
                : redactSkillCommandResult(nested),
            ],
          ]
    )
  );
}

function redactPrompt(value: Record<string, unknown>): unknown {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nested]) =>
      FORBIDDEN_SKILL_CONTENT_FIELDS.has(key)
        ? []
        : [[key, redactSkillCommandResult(nested)]]
    )
  );
}

function visitPromptFields(
  value: unknown,
  inspectPrompt: (field: string, prompt: Record<string, unknown>) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      visitPromptFields(item, inspectPrompt);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'promptReference' && !isRecord(nested)) {
      throw new Error(
        admin_skills_skill_promptreference_must_use_resolvabl_505aceb4()
      );
    }
    if (PROMPT_FIELDS.has(key) && isRecord(nested)) {
      inspectPrompt(key, nested);
    }
    visitPromptFields(nested, inspectPrompt);
  }
}

function isPinnedPromptReference(value: Record<string, unknown>) {
  return (
    typeof value.name === 'string' &&
    Boolean(value.name.trim()) &&
    !/^<[^>]+>$/u.test(value.name.trim()) &&
    typeof value.version === 'string' &&
    Boolean(value.version.trim()) &&
    !/^<[^>]+>$/u.test(value.version.trim()) &&
    typeof value.contentHash === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.contentHash)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
