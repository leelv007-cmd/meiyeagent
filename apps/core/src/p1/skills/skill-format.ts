import { parse, stringify } from 'yaml';

export const SKILL_FRONTMATTER_FIELDS = [
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
] as const;

export const SKILL_PACKAGE_PATHS = [
  'SKILL.md',
  'scripts/',
  'references/',
  'assets/',
  'evals/evals.json',
] as const;

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  'allowed-tools'?: string;
  metadata?: Record<string, string>;
  compatibility?: string;
}

export type SkillPackageFile = string | Uint8Array;

export interface ImportedSkillPackage {
  directoryName: string;
  frontmatter: SkillFrontmatter;
  instructions: string;
  files: Record<string, SkillPackageFile>;
}

export function importSkillPackage(
  input: {
    directoryName: string;
    files: Record<string, SkillPackageFile>;
  },
): ImportedSkillPackage {
  const packageFiles = input.files;
  const skillMarkdown = packageFiles['SKILL.md'];
  if (typeof skillMarkdown !== 'string') {
    throw new Error('Skill package requires a UTF-8 SKILL.md.');
  }
  const { frontmatter, instructions } = parseSkillMarkdown(skillMarkdown);
  if (frontmatter.name !== input.directoryName) {
    throw new Error('Skill frontmatter name must match its directory.');
  }
  const files: Record<string, SkillPackageFile> = {};
  for (const [path, value] of Object.entries(packageFiles)) {
    if (path === 'SKILL.md') continue;
    assertSafePackagePath(path);
    files[path] = structuredClone(value);
  }
  return {
    directoryName: input.directoryName,
    frontmatter,
    instructions,
    files,
  };
}

export function exportSkillPackage(
  skill: ImportedSkillPackage,
): Record<string, SkillPackageFile> {
  const frontmatter = validateFrontmatter(skill.frontmatter);
  if (frontmatter.name !== skill.directoryName) {
    throw new Error('Skill frontmatter name must match its directory.');
  }
  const files: Record<string, SkillPackageFile> = {
    'SKILL.md': serializeSkillMarkdown(frontmatter, skill.instructions),
  };
  for (const [path, value] of Object.entries(skill.files)) {
    assertSafePackagePath(path);
    files[path] = structuredClone(value);
  }
  return files;
}

function parseSkillMarkdown(markdown: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(
    markdown,
  );
  if (!match) {
    throw new Error('SKILL.md requires YAML frontmatter.');
  }
  const parsed = parse(match[1] ?? '');
  return {
    frontmatter: validateFrontmatter(parsed),
    instructions: (match[2] ?? '').trim(),
  };
}

function serializeSkillMarkdown(
  frontmatter: SkillFrontmatter,
  instructions: string,
) {
  const ordered = Object.fromEntries(
    SKILL_FRONTMATTER_FIELDS.flatMap((field) =>
      frontmatter[field] === undefined
        ? []
        : [[field, frontmatter[field]]],
    ),
  );
  return `---\n${stringify(ordered).trimEnd()}\n---\n\n${instructions.trim()}\n`;
}

function validateFrontmatter(value: unknown): SkillFrontmatter {
  if (!isRecord(value)) {
    throw new Error('Skill frontmatter must be a mapping.');
  }
  const allowed = new Set<string>(SKILL_FRONTMATTER_FIELDS);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`Unknown Skill frontmatter field: ${field}.`);
    }
  }
  const name = requiredString(value.name, 'name');
  if (
    name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
  ) {
    throw new Error(
      'Skill frontmatter name must use 1-64 lowercase letters, numbers, and hyphens without edge or consecutive hyphens.',
    );
  }
  const description = requiredString(value.description, 'description');
  if (description.length > 1024) {
    throw new Error('Skill frontmatter description exceeds 1024 characters.');
  }
  const optional = (field: 'license' | 'allowed-tools' | 'compatibility') => {
    const candidate = value[field];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== 'string') {
      throw new Error(`Skill frontmatter ${field} must be a string.`);
    }
    if (field === 'compatibility' && (!candidate || candidate.length > 500)) {
      throw new Error(
        'Skill frontmatter compatibility must contain 1-500 characters.',
      );
    }
    return candidate;
  };
  let metadata: Record<string, string> | undefined;
  if (value.metadata !== undefined) {
    if (
      !isRecord(value.metadata) ||
      Object.values(value.metadata).some(
        (candidate) => typeof candidate !== 'string',
      )
    ) {
      throw new Error('Skill frontmatter metadata values must be strings.');
    }
    metadata = structuredClone(value.metadata) as Record<string, string>;
  }
  return {
    name,
    description,
    ...(optional('license') === undefined
      ? {}
      : { license: optional('license') }),
    ...(optional('allowed-tools') === undefined
      ? {}
      : { 'allowed-tools': optional('allowed-tools') }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(optional('compatibility') === undefined
      ? {}
      : { compatibility: optional('compatibility') }),
  };
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Skill frontmatter ${field} is required.`);
  }
  return value;
}

function assertSafePackagePath(path: string) {
  const segments = path.split('/');
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\0') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Skill package path must be a safe relative path: ${path}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
