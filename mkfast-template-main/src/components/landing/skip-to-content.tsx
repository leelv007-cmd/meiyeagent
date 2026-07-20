import type { ReactNode } from 'react';
import { landing_a11y_skip_to_content } from '@/locale/paraglide/messages';

export function SkipToContent(): ReactNode {
  return (
    <a href="#main-content" className="skip-to-content">
      {landing_a11y_skip_to_content()}
    </a>
  );
}
