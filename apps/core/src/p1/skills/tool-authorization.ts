import { P1DomainError } from '../foundation/domain.js';

export interface SkillToolExecutionGrant {
  caller: string;
  toolId: string;
}

export interface SkillToolExecutionAuthorizer {
  authorize(input: SkillToolExecutionGrant): void;
}

export class StaticSkillToolExecutionAuthorizer
  implements SkillToolExecutionAuthorizer
{
  private readonly grants: ReadonlySet<string>;

  constructor(grants: readonly SkillToolExecutionGrant[]) {
    this.grants = new Set(
      grants.map(({ caller, toolId }) => compositeKey(caller, toolId)),
    );
  }

  authorize(input: SkillToolExecutionGrant) {
    if (!this.grants.has(compositeKey(input.caller, input.toolId))) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Skill tool execution requires an exact trusted tool grant.',
      );
    }
  }
}

export const denyAllSkillToolExecution =
  new StaticSkillToolExecutionAuthorizer([]);

function compositeKey(caller: string, toolId: string) {
  return `${caller.length}:${caller}${toolId.length}:${toolId}`;
}
