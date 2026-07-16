import type { Entitlement } from '@meiye/contracts';
import {
  quota_meter_content,
  quota_meter_package,
  quota_meter_storage,
  quota_meter_video,
} from '@/locale/paraglide/messages';

const quotaItems = [
  { key: 'content', label: quota_meter_content },
  { key: 'video', label: quota_meter_video },
  { key: 'package', label: quota_meter_package },
  { key: 'storageMb', label: quota_meter_storage },
] as const;

export function QuotaMeter({ entitlement }: { entitlement: Entitlement }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {quotaItems.map((item, index) => {
        const bucket = entitlement[item.key];
        return (
          <span key={item.key} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            <span>{item.label()}</span>
            <span className="font-medium tabular-nums">
              {bucket.remaining}
              <span className="font-normal">/{bucket.allowance}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}
