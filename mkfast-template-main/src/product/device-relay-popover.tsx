import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { getPathWithLocale } from '@/lib/urls';
import {
  device_relay_continue_on_phone,
  device_relay_copy_link,
  device_relay_link_copied,
  device_relay_popover_description,
  device_relay_popover_title,
  device_relay_qr_alt,
} from '@/locale/paraglide/messages';
import { IconCheck, IconCopy, IconDeviceMobile } from '@tabler/icons-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';

import { buildRelayLocation, type RelayTarget } from '@/product/device-relay';

export function buildDeviceRelayAbsoluteUrl(
  target: RelayTarget,
  origin: string = typeof window !== 'undefined' ? window.location.origin : ''
): string {
  const location = buildRelayLocation(target);
  const path = getPathWithLocale(location.pathWithSearch);
  if (!origin) return path;
  return new URL(path, origin).toString();
}

export function DeviceRelayPopover({
  target,
  className,
}: {
  target: RelayTarget;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [qrSrc, setQrSrc] = useState<string>();
  const [copied, setCopied] = useState(false);
  const absoluteUrl = useMemo(
    () =>
      typeof window === 'undefined'
        ? buildRelayLocation(target).pathWithSearch
        : buildDeviceRelayAbsoluteUrl(target),
    [target]
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQrSrc(undefined);
    void QRCode.toDataURL(absoluteUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 200,
      color: { dark: '#171717', light: '#ffffff' },
    }).then((src) => {
      if (!cancelled) setQrSrc(src);
    });
    return () => {
      cancelled = true;
    };
  }, [absoluteUrl, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(triggerProps) => (
          <Button
            {...triggerProps}
            className={className}
            data-testid="device-relay-trigger"
            size="sm"
            type="button"
            variant="outline"
          >
            <IconDeviceMobile className="size-4" aria-hidden="true" />
            {device_relay_continue_on_phone()}
          </Button>
        )}
      />
      <PopoverContent
        align="end"
        className="z-[var(--layer-popover)] w-72 space-y-3 rounded-2xl border border-[var(--glass-edge)] bg-[var(--glass-50)] p-3 shadow-[var(--shadow-overlay)] backdrop-blur-xl"
        data-testid="device-relay-popover"
      >
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {device_relay_popover_title()}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {device_relay_popover_description()}
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border bg-paper">
          {qrSrc ? (
            <img
              alt={device_relay_qr_alt()}
              className="aspect-square w-full bg-white object-contain p-2"
              data-testid="device-relay-qr"
              src={qrSrc}
            />
          ) : (
            <Skeleton className="aspect-square w-full" />
          )}
        </div>
        <Button
          className="min-h-touch-target w-full"
          data-testid="device-relay-copy"
          onClick={() => {
            void navigator.clipboard
              .writeText(absoluteUrl)
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                // 剪贴板不可用（非安全上下文/权限拒绝）时保持原文案，链接仍可手动选中复制。
              });
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          {copied ? (
            <IconCheck className="size-4" aria-hidden="true" />
          ) : (
            <IconCopy className="size-4" aria-hidden="true" />
          )}
          {copied ? device_relay_link_copied() : device_relay_copy_link()}
        </Button>
        <p
          className="truncate text-[0.75rem] text-muted-foreground"
          data-testid="device-relay-url"
          title={absoluteUrl}
        >
          {absoluteUrl}
        </p>
      </PopoverContent>
    </Popover>
  );
}
