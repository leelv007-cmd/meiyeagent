import {
  DEFAULT_BEAUTY_COPY_PROMPT_REVISION,
  getBeautyCopyPromptRevision,
} from '../p1/model-supply/quality-evaluation.js';

export const BEAUTY_COPY_PROMPT = getBeautyCopyPromptRevision(
  DEFAULT_BEAUTY_COPY_PROMPT_REVISION,
);

export { getBeautyCopyPromptRevision };
