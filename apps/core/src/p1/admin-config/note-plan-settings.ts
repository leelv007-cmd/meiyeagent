import {
  NOTE_STYLE_CONFIG_KEY,
  noteStyleConfigSchema,
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
    const styles = await this.repository.get(
      'global',
      '*',
      NOTE_STYLE_CONFIG_KEY,
    );
    return {
      styles: styles
        ? noteStyleConfigSchema.parse(styles.value)
        : structuredClone(DEFAULT_NOTE_STYLES),
    };
  }
}
