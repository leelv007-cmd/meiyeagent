import { parseSkillSchema } from '../../contracts/index.js';

import type { SkillOutputValidator } from './types.js';

export class RegistrySkillOutputValidator implements SkillOutputValidator {
  validate(input: {
    schemaRevision: string;
    value: unknown;
  }): {
    schemaValid: boolean;
    qualityPassed: boolean;
  } {
    try {
      parseSkillSchema(input.schemaRevision, input.value);
      return { schemaValid: true, qualityPassed: true };
    } catch {
      return { schemaValid: false, qualityPassed: false };
    }
  }
}
