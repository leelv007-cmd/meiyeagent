import {
  NOTE_CONFIRMATION_TIMEOUT_CONFIG_KEY,
  NOTE_STYLE_CONFIG_KEY,
  noteConfirmationTimeoutSchema,
  noteStyleConfigSchema,
  type NoteStyleConfig,
} from '@meiye/contracts';

import {
  DEFAULT_NOTE_STYLES,
  type NotePlanSettings,
  type NotePlanSettingsSource,
} from '../harness/note-plan-compiler.js';
import type { AdminConfigRepository } from './foundation-module.js';

export class AdminConfigNotePlanSettingsSource
  implements NotePlanSettingsSource
{
  constructor(private readonly repository: Pick<AdminConfigRepository, 'get'>) {}

  async read(): Promise<NotePlanSettings> {
    const [styles, timeout] = await Promise.all([
      this.repository.get('global', '*', NOTE_STYLE_CONFIG_KEY),
      this.repository.get(
        'global',
        '*',
        NOTE_CONFIRMATION_TIMEOUT_CONFIG_KEY,
      ),
    ]);
    return {
      styles: styles
        ? noteStyleConfigSchema.parse(styles.value)
        : structuredClone(DEFAULT_NOTE_STYLES),
      confirmationTimeoutSeconds: timeout
        ? noteConfirmationTimeoutSchema.parse(timeout.value)
        : 30,
    };
  }
}

export function notePlanStyleConfig(value: unknown): NoteStyleConfig {
  return noteStyleConfigSchema.parse(value);
}
