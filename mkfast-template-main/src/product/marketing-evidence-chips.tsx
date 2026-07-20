import type { MarketingPackageEvidence } from '@meiye/contracts';

import { Badge } from '@/components/ui/badge';
import { getLocale } from '@/lib/locale';

const COPY = {
  zh: {
    label: '成品身份说明',
    brandOfficial: '本次使用品牌官方口吻（未配置主理人 IP）',
  },
  en: {
    label: 'Deliverable identity note',
    brandOfficial:
      'Brand official voice used for this result (owner IP not configured)',
  },
} as const;

export function MarketingEvidenceChips({
  evidence,
}: {
  evidence?: Pick<MarketingPackageEvidence, 'identityFallback'>;
}) {
  if (evidence?.identityFallback !== 'brand_official') return null;
  const copy = COPY[getLocale()];

  return (
    <fieldset aria-label={copy.label} className="flex flex-wrap gap-2">
      <Badge className="h-auto whitespace-normal" variant="outline">
        {copy.brandOfficial}
      </Badge>
    </fieldset>
  );
}
