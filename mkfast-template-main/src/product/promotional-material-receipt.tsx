import type { PromotionalMaterialReceiptExtension } from '@meiye/contracts';

import { Badge } from '@/components/ui/badge';

export function PromotionalMaterialReceiptStatus({
  receipt,
}: {
  receipt: PromotionalMaterialReceiptExtension;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {receipt.capabilityStatus === 'assisted' ? (
        <Badge variant="outline">辅助完成 · 文字版</Badge>
      ) : null}
      {receipt.missingMaterialFallback === 'brand_safe_placeholder' ? (
        <Badge variant="outline">缺料 · 品牌安全占位</Badge>
      ) : null}
      {receipt.missingMaterialFallback === 'text_only' &&
      receipt.capabilityStatus !== 'assisted' ? (
        <Badge variant="outline">缺料 · 文字版</Badge>
      ) : null}
    </span>
  );
}
