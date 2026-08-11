import { Button } from '@/components/ui/button';
import {
  content_package_export_carrier_copy_moments,
  content_package_export_carrier_copy_spoken,
  content_package_export_carrier_download_moments,
  content_package_export_carrier_download_spoken,
  content_package_export_carrier_lineage_missing,
  content_package_export_carrier_open_appointment,
  content_package_export_carrier_open_image_set,
  content_package_export_carrier_open_offline,
  content_package_export_carrier_open_poster,
} from '@/locale/paraglide/messages';
import { downloadFile } from '@/lib/download';
import { getPathWithLocale } from '@/lib/urls';
import { operationsCommand } from '@/p1/client';
import {
  quickEditExportUseDeliverySchema,
  type QuickEditExportUseDelivery,
} from '@meiye/contracts';
import { IconArrowRight, IconCopy, IconDownload } from '@tabler/icons-react';

type FormattedTextDelivery = Extract<
  QuickEditExportUseDelivery,
  { kind: 'formatted_text' }
>;
type LightComposerDelivery = Extract<
  QuickEditExportUseDelivery,
  { kind: 'light_composer' }
>;
type LineagedLightComposerDelivery = LightComposerDelivery & {
  sourcePackageId: string;
  sourceVersionId: string;
};

type CreateWork = (
  action: string,
  payload: Record<string, unknown>
) => Promise<{ id: string }>;

interface ContentPackageExportCarrierProps {
  clipboard?: Pick<Clipboard, 'writeText'>;
  createWork?: CreateWork;
  delivery: QuickEditExportUseDelivery;
  download?: (text: string, fileName: string) => Promise<void> | void;
  navigate?: (href: string) => void;
}

export async function writeExportCarrierText(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> = navigator.clipboard
) {
  await clipboard.writeText(text);
}

export async function downloadExportCarrierText(
  text: string,
  fileName: string
) {
  await downloadFile(
    `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
    fileName
  );
}

function formattedTextLabels(delivery: FormattedTextDelivery) {
  return delivery.exportUse === 'wechat_moments'
    ? {
        copy: content_package_export_carrier_copy_moments(),
        download: content_package_export_carrier_download_moments(),
      }
    : {
        copy: content_package_export_carrier_copy_spoken(),
        download: content_package_export_carrier_download_spoken(),
      };
}

function lightComposerLabel(delivery: LightComposerDelivery) {
  switch (delivery.exportUse) {
    case 'offline_material':
      return content_package_export_carrier_open_offline();
    case 'poster':
      return content_package_export_carrier_open_poster();
    case 'image_set':
      return content_package_export_carrier_open_image_set();
    case 'appointment_card':
      return content_package_export_carrier_open_appointment();
  }
}

function hasTrustedLineage(
  delivery: LightComposerDelivery
): delivery is LineagedLightComposerDelivery {
  return Boolean(delivery.sourcePackageId && delivery.sourceVersionId);
}

export function lightComposerCarrierHref(
  workId: string,
  delivery: LightComposerDelivery
) {
  const path = getPathWithLocale(
    `/dashboard/works/${encodeURIComponent(workId)}`
  );
  const search = new URLSearchParams({
    exportCarrier: JSON.stringify(delivery),
  });
  return `${path}?${search}`;
}

export function parseLightComposerCarrier(value: unknown) {
  try {
    const delivery = quickEditExportUseDeliverySchema.safeParse(
      typeof value === 'string' ? JSON.parse(value) : value
    );
    return delivery.success && delivery.data.kind === 'light_composer'
      ? delivery.data
      : undefined;
  } catch {
    return undefined;
  }
}

export async function openLightComposerCarrier(
  delivery: LightComposerDelivery,
  createWork: CreateWork = (action, payload) =>
    operationsCommand<{ id: string }>(action, payload),
  navigate: (href: string) => void = (href) => window.location.assign(href)
) {
  if (!hasTrustedLineage(delivery)) {
    throw new Error(
      'Light Composer delivery requires trusted package lineage.'
    );
  }
  const spec = delivery.materialSpecs[0]!;
  const work = await createWork('create_work_from_content_package', {
    height: spec.height,
    sourcePackageId: delivery.sourcePackageId,
    sourceVersionId: delivery.sourceVersionId,
    width: spec.width,
  });
  navigate(lightComposerCarrierHref(work.id, delivery));
}

export function ContentPackageExportCarrier({
  clipboard,
  createWork,
  delivery,
  download = downloadExportCarrierText,
  navigate,
}: ContentPackageExportCarrierProps) {
  if (delivery.kind === 'light_composer') {
    if (!hasTrustedLineage(delivery)) {
      return (
        <output className="text-sm text-muted-foreground">
          {content_package_export_carrier_lineage_missing()}
        </output>
      );
    }
    return (
      <Button
        onClick={() => openLightComposerCarrier(delivery, createWork, navigate)}
        type="button"
        variant="outline"
      >
        {lightComposerLabel(delivery)}
        <IconArrowRight />
      </Button>
    );
  }
  const labels = formattedTextLabels(delivery);

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => writeExportCarrierText(delivery.text, clipboard)}
        type="button"
        variant="outline"
      >
        <IconCopy />
        {labels.copy}
      </Button>
      <Button
        onClick={() => download(delivery.text, delivery.fileName)}
        type="button"
        variant="outline"
      >
        <IconDownload />
        {labels.download}
      </Button>
    </div>
  );
}
