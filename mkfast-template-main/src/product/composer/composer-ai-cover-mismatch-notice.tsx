/**
 * Visible notice when an AI cover seed is active but the current form no
 * longer matches its signature (ratio / recipe / platform). Submission stays
 * allowed — this only surfaces the silent drop.
 */

import { composer_ai_cover_signature_mismatch_notice } from '@/locale/paraglide/messages';

export type ComposerAiCoverMismatchNoticeProps = {
  visible: boolean;
};

export function ComposerAiCoverMismatchNotice({
  visible,
}: ComposerAiCoverMismatchNoticeProps) {
  if (!visible) return null;
  return (
    <output
      className="mt-2 block text-amber-700 text-xs dark:text-amber-400"
      data-testid="composer-ai-cover-signature-mismatch"
    >
      {composer_ai_cover_signature_mismatch_notice()}
    </output>
  );
}
