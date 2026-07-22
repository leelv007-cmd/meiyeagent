import { IconCopy } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import {
  content_package_legacy_collapse,
  content_package_legacy_copy,
  content_package_legacy_expand,
} from '@/locale/paraglide/messages';

export async function writeTextToClipboard(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> = navigator.clipboard
) {
  await clipboard.writeText(text);
}

export function stableContentPackageSelection(contentId: string) {
  return { packageId: contentId };
}

export function LegacyContentBody({
  body,
  expanded,
  onCopy,
  onToggle,
}: {
  body: string;
  expanded: boolean;
  onCopy?: (text: string) => Promise<void> | void;
  onToggle: () => void;
}) {
  return (
    <>
      <p
        className={
          expanded
            ? 'whitespace-pre-wrap text-sm leading-6 text-muted-foreground'
            : 'line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground'
        }
      >
        {body}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          aria-expanded={expanded}
          size="sm"
          variant="ghost"
          onClick={onToggle}
        >
          {expanded
            ? content_package_legacy_collapse()
            : content_package_legacy_expand()}
        </Button>
        {onCopy ? (
          <Button size="sm" variant="ghost" onClick={() => void onCopy(body)}>
            <IconCopy />
            {content_package_legacy_copy()}
          </Button>
        ) : null}
      </div>
    </>
  );
}
