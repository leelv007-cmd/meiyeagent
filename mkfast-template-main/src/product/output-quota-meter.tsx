import {
  account_usage_copy,
  account_usage_image,
  account_usage_video,
  output_quota_meter_item,
} from '@/locale/paraglide/messages';
import type { AccountUsageProjection } from '@/product/account-usage';

const OUTPUT_RESOURCES = [
  { key: 'copy', label: account_usage_copy },
  { key: 'image', label: account_usage_image },
  { key: 'video', label: account_usage_video },
] as const;

export function OutputQuotaMeter({
  projection,
}: {
  projection: AccountUsageProjection;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {OUTPUT_RESOURCES.map((item, index) => {
        const usage = projection.usage[item.key];
        return (
          <span className="flex items-center gap-1" key={item.key}>
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span>
              {output_quota_meter_item({
                allowance: usage.allowance,
                available: usage.available,
                resource: item.label(),
              })}
            </span>
          </span>
        );
      })}
    </div>
  );
}
