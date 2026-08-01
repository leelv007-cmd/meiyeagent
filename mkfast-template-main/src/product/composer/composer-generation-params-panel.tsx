import { Button } from '@/components/ui/button';
import type { BeautyVoiceRole, CreationMode, ThinkingLevel } from '@meiye/contracts';

import {
  BEAUTY_VOICE_ROLE_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  shouldShowBeautyVoiceRole,
  shouldShowThinkingLevel,
  type ComposerGenerationParamsState,
} from './composer-generation-params';

export function ComposerGenerationParamsPanel({
  creationMode,
  disabled = false,
  onChange,
  state,
}: {
  creationMode: CreationMode;
  disabled?: boolean;
  onChange: (next: ComposerGenerationParamsState) => void;
  state: ComposerGenerationParamsState;
}) {
  const showVoice = shouldShowBeautyVoiceRole(creationMode);
  const showThinking = shouldShowThinkingLevel(creationMode);
  if (!showVoice && !showThinking) return null;

  return (
    <div
      className="flex flex-col gap-3"
      data-creation-mode={creationMode}
      data-testid="composer-generation-params"
    >
      {showVoice ? (
        <fieldset className="space-y-2" data-testid="composer-beauty-voice-role">
          <legend className="text-sm font-medium">这次用谁的口吻写</legend>
          <div className="flex flex-wrap gap-2">
            {BEAUTY_VOICE_ROLE_OPTIONS.map((option) => (
              <Button
                aria-pressed={state.beautyVoiceRole === option.id}
                data-testid={`composer-beauty-voice-role-${option.id}`}
                disabled={disabled}
                key={option.id}
                onClick={() =>
                  onChange({
                    ...state,
                    beautyVoiceRole:
                      state.beautyVoiceRole === option.id
                        ? null
                        : (option.id as BeautyVoiceRole),
                  })
                }
                size="sm"
                type="button"
                variant={
                  state.beautyVoiceRole === option.id ? 'secondary' : 'outline'
                }
              >
                {option.label}
              </Button>
            ))}
          </div>
          <p className="text-muted text-xs">
            不选就用你登记的门店口吻；选了就按这个美业角色写。
          </p>
        </fieldset>
      ) : null}

      {showThinking ? (
        <fieldset className="space-y-2" data-testid="composer-thinking-level">
          <legend className="text-sm font-medium">思考深度</legend>
          <div className="flex flex-wrap gap-2">
            {THINKING_LEVEL_OPTIONS.map((option) => (
              <Button
                aria-pressed={state.thinkingLevel === option.id}
                data-testid={`composer-thinking-level-${option.id}`}
                disabled={disabled}
                key={option.id}
                onClick={() =>
                  onChange({
                    ...state,
                    thinkingLevel: option.id as ThinkingLevel,
                  })
                }
                size="sm"
                type="button"
                variant={
                  state.thinkingLevel === option.id ? 'secondary' : 'outline'
                }
              >
                {option.label}
              </Button>
            ))}
          </div>
          <p className="text-muted text-xs">
            {
              THINKING_LEVEL_OPTIONS.find(
                (option) => option.id === state.thinkingLevel
              )?.description
            }
          </p>
        </fieldset>
      ) : null}
    </div>
  );
}
