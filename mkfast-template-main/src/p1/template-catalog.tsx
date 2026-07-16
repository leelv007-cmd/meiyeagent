import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconEye,
  IconPencil,
  IconPinned,
  IconPinnedOff,
  IconPlus,
  IconRefresh,
  IconTemplate,
  IconTrash,
} from '@tabler/icons-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { m } from '@/locale/paraglide/messages';

import type {
  FilterOption,
  TemplateAction,
  TemplateCatalogItemView,
  TemplateOwnerKind,
} from './types';

export const P1_TEMPLATE_FAMILIES = [
  m.p1_template_family_social_cover(),
  m.p1_template_family_before_after(),
  m.p1_template_family_price_card(),
  m.p1_template_family_package_explainer(),
  m.p1_template_family_review_card(),
  m.p1_template_family_store_intro(),
  m.p1_template_family_shooting_checklist(),
] as const;

const SEED_TEMPLATE_PREVIEW_BY_FAMILY: Record<string, string | undefined> = {
  before_after: '/seed/template/template-before-after.webp',
  package_explainer: '/seed/template/template-tutorial.webp',
  review_card: '/seed/template/template-qna.webp',
  shooting_checklist: '/seed/template/template-checklist.webp',
  social_cover: '/seed/template/template-event.webp',
  store_intro: '/seed/template/template-store-visit.webp',
};

export function seedTemplatePreviewUrl(family: string) {
  return SEED_TEMPLATE_PREVIEW_BY_FAMILY[family];
}

export interface TemplatePreviewView {
  document: Record<string, unknown>;
  name: string;
  versionId: string;
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function canvasNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function TemplateDocumentPreview({
  preview,
}: {
  preview: TemplatePreviewView;
}) {
  const width = Math.max(1, canvasNumber(preview.document.width, 1080));
  const height = Math.max(1, canvasNumber(preview.document.height, 1350));
  const pages = Array.isArray(preview.document.pages)
    ? preview.document.pages
    : [];
  const page = record(pages[0]);
  const elements = Array.isArray(page?.elements) ? page.elements : [];

  return (
    <svg
      aria-label={m.p1_template_canvas_preview_aria({ name: preview.name })}
      className="max-h-[65vh] w-full rounded-lg bg-white shadow-sm"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      style={{ aspectRatio: `${width} / ${height}` }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>{m.p1_template_canvas_preview_aria({ name: preview.name })}</title>
      <rect fill="#ffffff" height={height} width={width} x={0} y={0} />
      {elements.map((value, index) => {
        const element = record(value);
        if (!element) return null;
        const id = typeof element.id === 'string' ? element.id : `${index}`;
        const x = canvasNumber(element.x, 0);
        const y = canvasNumber(element.y, 0);
        const elementWidth = Math.max(0, canvasNumber(element.width, width));
        const elementHeight = Math.max(0, canvasNumber(element.height, 120));
        const rotation = canvasNumber(element.rotation, 0);
        const opacity = Math.min(
          1,
          Math.max(0, canvasNumber(element.opacity, 1))
        );
        const transform = `rotate(${rotation} ${x + elementWidth / 2} ${y + elementHeight / 2})`;

        if (element.kind === 'text') {
          const text = typeof element.text === 'string' ? element.text : '';
          const fontSize = Math.max(1, canvasNumber(element.fontSize, 36));
          return (
            <text
              dominantBaseline="hanging"
              fill={typeof element.fill === 'string' ? element.fill : '#111827'}
              fontFamily={
                typeof element.fontFamily === 'string'
                  ? element.fontFamily
                  : 'sans-serif'
              }
              fontSize={fontSize}
              key={id}
              opacity={opacity}
              transform={transform}
              x={x}
              y={y}
            >
              {text.split('\n').map((line, lineIndex) => (
                <tspan
                  dy={lineIndex === 0 ? 0 : fontSize * 1.3}
                  key={`${id}-${lineIndex}`}
                  x={x}
                >
                  {line}
                </tspan>
              ))}
            </text>
          );
        }

        if (element.kind === 'image' && typeof element.src === 'string') {
          return (
            <image
              height={elementHeight}
              href={element.src}
              key={id}
              opacity={opacity}
              preserveAspectRatio="xMidYMid slice"
              transform={transform}
              width={elementWidth}
              x={x}
              y={y}
            />
          );
        }

        return (
          <g key={id} opacity={opacity} transform={transform}>
            <rect
              fill="#f1f5f9"
              height={elementHeight}
              stroke="#cbd5e1"
              width={elementWidth}
              x={x}
              y={y}
            />
            <text fill="#64748b" fontSize={28} x={x + 24} y={y + 48}>
              {m.p1_template_image_asset()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface ShortcutBarProps {
  items: TemplateCatalogItemView[];
  onAction: (templateId: string, action: TemplateAction) => void;
}

export function TemplateShortcutBar({ items, onAction }: ShortcutBarProps) {
  const sortedItems = [...items].sort(
    (left, right) =>
      (left.shortcutPosition ?? Number.MAX_SAFE_INTEGER) -
      (right.shortcutPosition ?? Number.MAX_SAFE_INTEGER)
  );

  return (
    <section
      aria-labelledby="p1-template-shortcuts-title"
      className="space-y-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="p1-template-shortcuts-title" className="font-medium">
            {m.p1_template_shortcuts_title()}
          </h3>
          <p className="text-xs text-muted-foreground">
            {m.p1_template_shortcuts_description()}
          </p>
        </div>
        <Badge variant="outline" className="tabular-nums">
          {m.p1_template_count({ count: sortedItems.length })}
        </Badge>
      </div>
      {sortedItems.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {m.p1_template_shortcuts_empty()}
        </div>
      ) : (
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-2 pb-3">
            {sortedItems.map((item, index) => {
              const previewUrl =
                item.thumbnailUrl ?? seedTemplatePreviewUrl(item.family);
              return (
                <div
                  key={item.id}
                  className="flex w-60 shrink-0 items-center gap-3 rounded-xl border bg-background p-2.5"
                >
                  <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={m.p1_template_preview_alt({ name: item.name })}
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <IconTemplate
                        className="size-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.versionLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => onAction(item.id, 'move_up')}
                      aria-label={m.p1_template_move_forward_aria({
                        name: item.name,
                      })}
                    >
                      <IconArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={index === sortedItems.length - 1}
                      onClick={() => onAction(item.id, 'move_down')}
                      aria-label={m.p1_template_move_backward_aria({
                        name: item.name,
                      })}
                    >
                      <IconArrowDown aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </section>
  );
}

export interface TemplateCatalogProps {
  items: TemplateCatalogItemView[];
  shortcuts: TemplateCatalogItemView[];
  familyOptions: FilterOption[];
  activeFamily: string;
  activeOwnerKind: 'all' | TemplateOwnerKind;
  pendingTemplateIds?: string[];
  preview?: TemplatePreviewView;
  onFamilyChange: (family: string) => void;
  onOwnerKindChange: (kind: 'all' | TemplateOwnerKind) => void;
  onAction: (templateId: string, action: TemplateAction) => void;
  onPreviewClose: () => void;
  onStartBlank: () => void;
}

export function TemplateCatalog({
  items,
  shortcuts,
  familyOptions,
  activeFamily,
  activeOwnerKind,
  pendingTemplateIds = [],
  preview,
  onFamilyChange,
  onOwnerKindChange,
  onAction,
  onPreviewClose,
  onStartBlank,
}: TemplateCatalogProps) {
  return (
    <section aria-labelledby="p1-template-catalog-title" className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-primary uppercase">
            {m.p1_template_eyebrow()}
          </p>
          <h2 id="p1-template-catalog-title" className="text-xl font-semibold">
            {m.p1_template_title()}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {m.p1_template_description()}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onStartBlank}>
          <IconPlus aria-hidden="true" />
          {m.p1_template_blank_canvas()}
        </Button>
      </header>

      <TemplateShortcutBar items={shortcuts} onAction={onAction} />

      <div className="space-y-3 border-y py-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', m.p1_template_owner_all()],
              ['official', m.p1_template_owner_official()],
              ['user', m.p1_template_owner_user()],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={activeOwnerKind === value ? 'default' : 'outline'}
              onClick={() => onOwnerKindChange(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">
            {m.p1_template_family_filter_legend()}
          </legend>
          {familyOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="xs"
              variant={activeFamily === option.value ? 'secondary' : 'ghost'}
              onClick={() => onFamilyChange(option.value)}
            >
              {option.label}
              {typeof option.count === 'number' && (
                <span className="text-muted-foreground tabular-nums">
                  {option.count}
                </span>
              )}
            </Button>
          ))}
        </fieldset>
      </div>

      {items.length === 0 ? (
        <div className="grid min-h-48 place-items-center rounded-xl border border-dashed p-6 text-center">
          <div>
            <IconTemplate
              className="mx-auto size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="mt-3 font-medium">{m.p1_template_empty_title()}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {m.p1_template_empty_description()}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const pending = pendingTemplateIds.includes(item.id);
            const previewUrl =
              item.thumbnailUrl ?? seedTemplatePreviewUrl(item.family);
            const copyLabel =
              item.ownerKind === 'user'
                ? m.p1_template_copy_user_aria({ name: item.name })
                : m.p1_template_copy_fixed_aria({ name: item.name });
            return (
              <Card key={item.id} className="py-0">
                <div className="aspect-[4/3] overflow-hidden bg-muted">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={m.p1_template_preview_alt({ name: item.name })}
                      className="size-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid size-full place-items-center">
                      <IconTemplate
                        className="size-10 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                </div>
                <CardHeader className="pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{item.familyLabel}</Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        item.ownerKind === 'official'
                          ? 'border-primary/30 text-primary'
                          : 'text-muted-foreground'
                      )}
                    >
                      {item.ownerKind === 'official'
                        ? m.p1_template_owner_official()
                        : m.p1_template_owner_user()}
                    </Badge>
                    {item.retired && (
                      <Badge variant="outline">{m.p1_template_retired()}</Badge>
                    )}
                  </div>
                  <h3 className="mt-2 font-medium">{item.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {item.versionLabel}
                  </p>
                </CardHeader>
                <CardContent>
                  {item.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  {item.updateAvailable && (
                    <p className="mt-2 text-xs font-medium text-primary">
                      {m.p1_template_update_available()}
                    </p>
                  )}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => onAction(item.id, 'preview')}
                  >
                    <IconEye aria-hidden="true" />
                    {m.p1_template_preview()}
                  </Button>
                  {item.canCreate && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => onAction(item.id, 'create')}
                    >
                      <IconPlus aria-hidden="true" />
                      {m.p1_template_create()}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      onAction(item.id, item.isShortcut ? 'hide' : 'pin')
                    }
                    aria-label={
                      item.isShortcut
                        ? m.p1_template_hide_shortcut_aria({ name: item.name })
                        : m.p1_template_pin_shortcut_aria({ name: item.name })
                    }
                  >
                    {item.isShortcut ? (
                      <IconPinnedOff aria-hidden="true" />
                    ) : (
                      <IconPinned aria-hidden="true" />
                    )}
                  </Button>
                  {item.updateAvailable && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => onAction(item.id, 'upgrade')}
                      aria-label={m.p1_template_upgrade_aria({
                        name: item.name,
                      })}
                    >
                      <IconRefresh aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => onAction(item.id, 'copy')}
                    aria-label={copyLabel}
                    title={copyLabel}
                  >
                    <IconCopy aria-hidden="true" />
                  </Button>
                  {item.ownerKind === 'user' && (
                    <>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => onAction(item.id, 'rename')}
                        aria-label={m.p1_template_rename_aria({
                          name: item.name,
                        })}
                      >
                        <IconPencil aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="destructive"
                        disabled={pending}
                        onClick={() => onAction(item.id, 'delete')}
                        aria-label={m.p1_template_delete_aria({
                          name: item.name,
                        })}
                      >
                        <IconTrash aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) onPreviewClose();
        }}
      >
        {preview && (
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{preview.name}</DialogTitle>
              <DialogDescription>
                {m.p1_template_preview_description({
                  revision: preview.versionId,
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[68vh] place-items-center overflow-auto rounded-xl bg-muted p-3">
              <TemplateDocumentPreview preview={preview} />
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
