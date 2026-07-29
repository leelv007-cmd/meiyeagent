const FORBIDDEN_SKILL_CONTENT_FIELDS = new Set(['content', 'fallbackContent']);
const PROMPT_FIELDS = new Set(['prompt', 'promptReference']);

export function assertReferenceOnlySkillPayload(value: unknown): void {
  visitPromptFields(value, (prompt) => {
    for (const key of Object.keys(prompt)) {
      if (FORBIDDEN_SKILL_CONTENT_FIELDS.has(key)) {
        throw new Error(
          `Skill 命令不能包含 ${key}；请只提交已冻结的 prompt 引用。`
        );
      }
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
  inspectPrompt: (prompt: Record<string, unknown>) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      visitPromptFields(item, inspectPrompt);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (PROMPT_FIELDS.has(key) && isRecord(nested)) {
      inspectPrompt(nested);
    }
    visitPromptFields(nested, inspectPrompt);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
