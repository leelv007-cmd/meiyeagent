import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  creation_shelf_add_to_creation,
  creation_shelf_bring_into_work,
  creation_shelf_canvas_create_failed,
  creation_shelf_catalog_error,
  creation_shelf_collapse_catalog,
  creation_shelf_confirm_decomposition,
  creation_shelf_confirm_inheritance,
  creation_shelf_continue_inheritance,
  creation_shelf_create_canvas,
  creation_shelf_decompose,
  creation_shelf_decomposition_description,
  creation_shelf_decomposition_guardrail,
  creation_shelf_decomposition_legend,
  creation_shelf_decomposition_title,
  creation_shelf_description,
  creation_shelf_expand_catalog,
  creation_shelf_filter_all,
  creation_shelf_inheritance_description,
  creation_shelf_inheritance_guardrail,
  creation_shelf_inheritance_legend,
  creation_shelf_inheritance_title,
  creation_shelf_input_guide_label,
  creation_shelf_insert_action,
  creation_shelf_inserting,
  creation_shelf_my_content,
  creation_shelf_new_blank_canvas,
  creation_shelf_no_decomposition_sources,
  creation_shelf_no_quick_templates,
  creation_shelf_official_library,
  creation_shelf_owner_mine,
  creation_shelf_owner_official,
  creation_shelf_pending_label,
  creation_shelf_pending_rechecking,
  creation_shelf_pending_unavailable,
  creation_shelf_pending_verifying,
  creation_shelf_pin_aria,
  creation_shelf_preview_unavailable,
  creation_shelf_recheck,
  creation_shelf_shortcut_update_failed,
  creation_shelf_template_preview_alt,
  creation_shelf_template_unavailable,
  creation_shelf_title,
  creation_shelf_tool_inserted,
  creation_shelf_tool_placed,
  creation_shelf_tool_verification_missing,
  creation_shelf_unpin_aria,
} from '@/locale/paraglide/messages';
import { emitTelemetry } from '@/lib/product-telemetry';
import { getPathWithLocale } from '@/lib/urls';
import { operationsCommand, operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { ModelOperation } from '@/p1/settings-view-model';
import {
  seedTemplatePreviewUrl,
  TemplateDocumentPreview,
} from '@/p1/template-catalog';
import type {
  CreativeInheritanceFieldId,
  CreativeSourceReference,
} from '@meiye/contracts';
import {
  IconBolt,
  IconCommand,
  IconPhoto,
  IconPinned,
  IconPinnedOff,
  IconSparkles,
  IconTemplate,
  IconVideo,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type {
  RawCanonicalHistory,
  RawCanvasWork,
} from './canonical-history-model';
import {
  projectCreationCatalog,
  type CreationCatalogEntry,
  type CreationCatalogResponse,
} from './creation-catalog-model';
import {
  inheritanceDefaults,
  INHERITANCE_FIELD_OPTIONS,
  quickTemplateEntries,
  referenceWithInheritance,
} from './creation-shelf-model';
import { useCreativeToolAvailability } from './creative-tool-availability';
import { useGlobalCommand } from './global-command-palette';

function iconFor(entry: CreationCatalogEntry) {
  if (entry.kind === 'template') return IconTemplate;
  if (entry.operation === 'image.generate') return IconPhoto;
  if (entry.operation === 'video.generate') return IconVideo;
  if (entry.kind === 'tool') return IconBolt;
  return IconSparkles;
}

function TemplatePreview({ entry }: { entry: CreationCatalogEntry }) {
  const template = entry.template;
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  if (template?.previewDocument) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-muted p-3 [&>svg]:h-full [&>svg]:w-full">
        <TemplateDocumentPreview
          preview={{
            document: template.previewDocument,
            name: template.name,
            versionId: template.previewVersionId ?? template.versionLabel,
          }}
        />
      </div>
    );
  }
  if (template?.thumbnailUrl && failedThumbnail !== template.thumbnailUrl) {
    return (
      <div className="aspect-[3/4] overflow-hidden bg-muted">
        <img
          alt={creation_shelf_template_preview_alt({ name: entry.label })}
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailedThumbnail(template.thumbnailUrl)}
          src={template.thumbnailUrl}
        />
      </div>
    );
  }
  const seedPreviewUrl = template
    ? seedTemplatePreviewUrl(template.family)
    : undefined;
  if (seedPreviewUrl) {
    return (
      <div className="aspect-[3/4] overflow-hidden bg-surface-1">
        <img
          alt={creation_shelf_template_preview_alt({ name: entry.label })}
          className="size-full object-cover"
          loading="lazy"
          src={seedPreviewUrl}
        />
      </div>
    );
  }
  return (
    <div className="grid aspect-[3/4] place-items-center bg-linear-to-br from-primary/20 via-muted to-chart-1/20 text-center">
      <span>
        <IconTemplate
          aria-hidden="true"
          className="mx-auto size-8 text-muted-foreground"
        />
        <span className="mt-2 block text-xs text-muted-foreground">
          {creation_shelf_preview_unavailable()}
        </span>
      </span>
    </div>
  );
}

function TemplateCard({
  entry,
  onBringIn,
  onCreateCanvas,
  onToggleShortcut,
}: {
  entry: CreationCatalogEntry;
  onBringIn: (entry: CreationCatalogEntry) => void;
  onCreateCanvas: (entry: CreationCatalogEntry) => void;
  onToggleShortcut: (entry: CreationCatalogEntry) => void;
}) {
  const template = entry.template;
  return (
    <Card className="overflow-hidden py-0">
      <div className="relative overflow-hidden">
        <TemplatePreview entry={entry} />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent via-black/5 to-black/85"
        />
        <CardHeader className="absolute inset-x-0 bottom-0 z-10 p-4 pt-20 text-white">
          <div className="flex items-end justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-white">
              {entry.label}
            </CardTitle>
            <Badge
              className="border-white/30 bg-black/20 text-white backdrop-blur-sm"
              variant="outline"
            >
              {entry.owner === 'official'
                ? creation_shelf_owner_official()
                : creation_shelf_owner_mine()}
            </Badge>
          </div>
          <p className="line-clamp-2 text-xs text-white/80">{entry.detail}</p>
        </CardHeader>
      </div>
      <CardContent className="space-y-3 pb-4">
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
          {template?.familyLabel ? (
            <Badge variant="outline">{template.familyLabel}</Badge>
          ) : null}
        </div>
        {template?.inputGuide ? (
          <p className="text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">
              {creation_shelf_input_guide_label()}
            </span>
            {template.inputGuide}
          </p>
        ) : null}
        {!entry.available ? (
          <p className="text-xs text-destructive">
            {entry.unavailableReason ?? creation_shelf_template_unavailable()}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!entry.available}
            onClick={() => onBringIn(entry)}
            size="xs"
            type="button"
          >
            {creation_shelf_bring_into_work()}
          </Button>
          <Button
            disabled={!entry.available}
            onClick={() => onCreateCanvas(entry)}
            size="xs"
            type="button"
            variant="outline"
          >
            {creation_shelf_create_canvas()}
          </Button>
          <Button
            aria-label={
              entry.shortcut
                ? creation_shelf_unpin_aria({ name: entry.label })
                : creation_shelf_pin_aria({ name: entry.label })
            }
            onClick={() => onToggleShortcut(entry)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            {entry.shortcut ? (
              <IconPinnedOff aria-hidden="true" />
            ) : (
              <IconPinned aria-hidden="true" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CreationShelf({
  onInsertReference,
  onSelectTool,
}: {
  onInsertReference: (reference: CreativeSourceReference) => Promise<void>;
  onSelectTool: (operation: ModelOperation) => void;
}) {
  const queryClient = useQueryClient();
  const { consumePendingAction, openPalette, pendingAction } =
    useGlobalCommand();
  const [expanded, setExpanded] = useState(false);
  const [decompositionOpen, setDecompositionOpen] = useState(false);
  const [inheritanceOpen, setInheritanceOpen] = useState(false);
  const [owner, setOwner] = useState<'all' | 'official' | 'user'>('all');
  const [sourceScope, setSourceScope] = useState<'official' | 'user'>(
    'official'
  );
  const [selectedSource, setSelectedSource] = useState<CreationCatalogEntry>();
  const [selectedFields, setSelectedFields] = useState<
    CreativeInheritanceFieldId[]
  >([]);
  const [inheritanceEntry, setInheritanceEntry] =
    useState<CreationCatalogEntry>();
  const [inheritanceOrigin, setInheritanceOrigin] = useState<
    'shelf' | 'command_palette'
  >('shelf');
  const [inserting, setInserting] = useState(false);
  const [promptedPendingKey, setPromptedPendingKey] = useState<string>();
  const [pendingUnavailableMessage, setPendingUnavailableMessage] =
    useState<string>();

  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'creation_catalog'),
    queryFn: ({ signal }) =>
      operationsQuery<CreationCatalogResponse>('creation_catalog', {}, signal),
  });
  const historyQuery = useQuery({
    enabled: expanded || decompositionOpen || Boolean(pendingAction?.reference),
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  const toolCatalog = useCreativeToolAvailability(true);
  const shortcutMutation = useMutation({
    mutationFn: (shortcuts: CreationCatalogResponse['shortcuts']) =>
      operationsCommand('set_template_shortcuts', { shortcuts }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('operations', 'creation_catalog'),
      });
    },
    onError: () => toast.error(creation_shelf_shortcut_update_failed()),
  });
  const canvasMutation = useMutation({
    mutationFn: (entry?: CreationCatalogEntry) => {
      if (!entry) {
        return operationsCommand<RawCanvasWork>('create_blank_work', {
          height: 1350,
          width: 1080,
        });
      }
      return entry.owner === 'official'
        ? operationsCommand<RawCanvasWork>('create_work', {
            templateId: entry.id,
          })
        : operationsCommand<RawCanvasWork>('create_work_from_user_template', {
            userTemplateId: entry.id,
          });
    },
    onSuccess: (work) =>
      window.location.assign(
        getPathWithLocale(`/dashboard/results/${encodeURIComponent(work.id)}`)
      ),
    onError: () => toast.error(creation_shelf_canvas_create_failed()),
  });

  useEffect(() => {
    if (!decompositionOpen) return;
    setSelectedSource(undefined);
    setSelectedFields(inheritanceDefaults('decomposition'));
  }, [decompositionOpen, sourceScope]);

  const catalogEntries = useMemo(
    () =>
      projectCreationCatalog(
        catalogQuery.data,
        historyQuery.data,
        toolCatalog.availability
      ),
    [catalogQuery.data, historyQuery.data, toolCatalog.availability]
  );
  const templateEntries = catalogEntries.filter(
    (entry) => entry.kind === 'template'
  );
  const visibleEntries = catalogEntries.filter(
    (entry) => owner === 'all' || entry.owner === owner
  );
  const quickTemplates = quickTemplateEntries(templateEntries);
  const quickTools = catalogEntries
    .filter((entry) => entry.kind === 'tool')
    .slice(0, 2);
  const decompositionEntries = catalogEntries.filter(
    (entry) =>
      entry.owner === sourceScope &&
      (entry.kind === 'template' || entry.kind === 'reference')
  );

  const beginInheritance = (
    entry: CreationCatalogEntry,
    origin: 'shelf' | 'command_palette'
  ) => {
    if (!entry.reference) return;
    setInheritanceEntry(entry);
    setInheritanceOrigin(origin);
    setSelectedFields(inheritanceDefaults(origin));
    setInheritanceOpen(true);
  };

  useEffect(() => {
    if (!pendingAction) {
      setPromptedPendingKey(undefined);
      setPendingUnavailableMessage(undefined);
      return;
    }
    if (pendingAction.kind === 'tool' && pendingAction.operation) {
      const entry = catalogEntries.find(
        (candidate) => candidate.key === pendingAction.key
      );
      if (!entry?.available) {
        setPendingUnavailableMessage(
          entry?.unavailableReason ?? creation_shelf_tool_verification_missing()
        );
        return;
      }
      setPendingUnavailableMessage(undefined);
      onSelectTool(entry.operation ?? pendingAction.operation);
      consumePendingAction(pendingAction.key);
      toast.success(creation_shelf_tool_placed());
      return;
    }
    if (!pendingAction.reference || promptedPendingKey === pendingAction.key) {
      return;
    }
    const needsHistory = pendingAction.reference.kind !== 'template';
    if (!catalogQuery.isSuccess || (needsHistory && !historyQuery.isSuccess)) {
      setPendingUnavailableMessage(creation_shelf_pending_verifying());
      return;
    }
    const entry = catalogEntries.find(
      (candidate) => candidate.key === pendingAction.key
    );
    if (!entry?.available) {
      setPendingUnavailableMessage(
        entry?.unavailableReason ?? creation_shelf_pending_unavailable()
      );
      return;
    }
    setPendingUnavailableMessage(undefined);
    setPromptedPendingKey(pendingAction.key);
    beginInheritance(entry, 'command_palette');
  }, [
    catalogQuery.isSuccess,
    catalogEntries,
    consumePendingAction,
    historyQuery.isSuccess,
    onSelectTool,
    pendingAction,
    promptedPendingKey,
  ]);

  const choose = (entry: CreationCatalogEntry) => {
    if (!entry.available) return;
    if (entry.kind === 'tool' && entry.operation) {
      emitTelemetry('tool_action', {
        action: 'selected',
        tool: entry.operation,
      });
      onSelectTool(entry.operation);
      toast.success(creation_shelf_tool_inserted());
      return;
    }
    beginInheritance(entry, 'shelf');
  };

  const confirmInheritance = async () => {
    if (!inheritanceEntry?.reference || selectedFields.length === 0) return;
    setInserting(true);
    try {
      await onInsertReference(
        referenceWithInheritance(inheritanceEntry.reference, selectedFields)
      );
      if (inheritanceOrigin === 'command_palette') {
        consumePendingAction(inheritanceEntry.key);
      }
      setInheritanceOpen(false);
    } catch {
      // The parent mutation keeps the dialog open and renders the retry toast.
    } finally {
      setInserting(false);
    }
  };

  const toggleShortcut = (entry: CreationCatalogEntry) => {
    const shortcuts = catalogQuery.data?.shortcuts ?? [];
    if (entry.shortcut) {
      shortcutMutation.mutate(
        shortcuts.filter(
          (item) => (item.templateId ?? item.userTemplateId) !== entry.id
        )
      );
      return;
    }
    shortcutMutation.mutate([
      ...shortcuts,
      entry.owner === 'official'
        ? { hidden: false, rank: shortcuts.length, templateId: entry.id }
        : { hidden: false, rank: shortcuts.length, userTemplateId: entry.id },
    ]);
  };

  const retryPendingAction = async () => {
    setPendingUnavailableMessage(creation_shelf_pending_rechecking());
    await Promise.all([
      catalogQuery.refetch(),
      historyQuery.refetch(),
      toolCatalog.refetch(),
    ]);
    setPromptedPendingKey(undefined);
  };

  return (
    <section
      aria-labelledby="creation-shelf-title"
      className="space-y-4 rounded-md border bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold" id="creation-shelf-title">
            {creation_shelf_title()}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {creation_shelf_description()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={openPalette}
            size="sm"
            type="button"
            variant="outline"
          >
            <IconCommand aria-hidden="true" />
            {creation_shelf_add_to_creation()}
            <kbd className="ml-1 text-xs">⌘K</kbd>
          </Button>
          <Button
            onClick={() => setDecompositionOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {creation_shelf_decompose()}
          </Button>
          <Button
            onClick={() => setExpanded((value) => !value)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {expanded
              ? creation_shelf_collapse_catalog()
              : creation_shelf_expand_catalog()}
          </Button>
        </div>
      </div>

      {catalogQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {creation_shelf_catalog_error()}
        </div>
      ) : null}

      {pendingAction && !inheritanceOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm">
          <span className="space-y-1">
            <span className="block">
              {creation_shelf_pending_label()}
              <span className="font-medium">{pendingAction.label}</span>
            </span>
            {pendingUnavailableMessage ? (
              <span className="block text-xs text-destructive">
                {pendingUnavailableMessage}
              </span>
            ) : null}
          </span>
          <Button
            onClick={() => {
              if (pendingUnavailableMessage) {
                void retryPendingAction();
              } else {
                setPromptedPendingKey(undefined);
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {pendingUnavailableMessage
              ? creation_shelf_recheck()
              : creation_shelf_continue_inheritance()}
          </Button>
        </div>
      ) : null}

      {quickTemplates.length > 0 ? (
        <div className="relative -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
          <div className="inline-flex gap-3 sm:grid sm:w-full sm:grid-cols-2">
            {quickTemplates.map((entry) => (
              <div className="w-64 shrink-0 sm:w-auto" key={entry.key}>
                <TemplateCard
                  entry={entry}
                  onBringIn={choose}
                  onCreateCanvas={(item) => canvasMutation.mutate(item)}
                  onToggleShortcut={toggleShortcut}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {creation_shelf_no_quick_templates()}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {quickTools.map((entry) => {
          const Icon = iconFor(entry);
          return (
            <div className="space-y-1" key={entry.key}>
              <Button
                disabled={!entry.available}
                onClick={() => choose(entry)}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Icon aria-hidden="true" />
                {entry.label}
              </Button>
              {entry.unavailableReason ? (
                <p className="max-w-48 text-xs text-destructive">
                  {entry.unavailableReason}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {expanded ? (
        <div className="space-y-3 border-t pt-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'official', 'user'] as const).map((value) => (
              <Button
                key={value}
                onClick={() => setOwner(value)}
                size="xs"
                type="button"
                variant={owner === value ? 'secondary' : 'ghost'}
              >
                {value === 'all'
                  ? creation_shelf_filter_all()
                  : value === 'official'
                    ? creation_shelf_owner_official()
                    : creation_shelf_owner_mine()}
              </Button>
            ))}
            <Button
              disabled={canvasMutation.isPending}
              onClick={() => canvasMutation.mutate(undefined)}
              size="xs"
              type="button"
              variant="outline"
            >
              {creation_shelf_new_blank_canvas()}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleEntries.map((entry) => {
              if (entry.kind === 'template') {
                return (
                  <TemplateCard
                    entry={entry}
                    key={entry.key}
                    onBringIn={choose}
                    onCreateCanvas={(item) => canvasMutation.mutate(item)}
                    onToggleShortcut={toggleShortcut}
                  />
                );
              }
              const Icon = iconFor(entry);
              return (
                <Card key={entry.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Icon aria-hidden="true" className="size-4" />
                      {entry.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p
                      className={
                        entry.unavailableReason
                          ? 'text-xs text-destructive'
                          : 'text-xs text-muted-foreground'
                      }
                    >
                      {entry.unavailableReason ?? entry.detail}
                    </p>
                    <Button
                      disabled={!entry.available}
                      onClick={() => choose(entry)}
                      size="xs"
                      type="button"
                    >
                      {entry.kind === 'tool'
                        ? creation_shelf_insert_action()
                        : creation_shelf_bring_into_work()}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      <Dialog open={inheritanceOpen} onOpenChange={setInheritanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{creation_shelf_inheritance_title()}</DialogTitle>
            <DialogDescription>
              {creation_shelf_inheritance_description()}
            </DialogDescription>
          </DialogHeader>
          {inheritanceEntry ? (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/25 p-3 text-sm">
                <p className="font-medium">{inheritanceEntry.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {inheritanceEntry.detail}
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="sr-only">
                  {creation_shelf_inheritance_legend()}
                </legend>
                {INHERITANCE_FIELD_OPTIONS.map((field) => (
                  <div
                    className="flex min-h-touch-target items-center gap-3 rounded-md border px-3 text-sm"
                    key={field.id}
                  >
                    <Checkbox
                      checked={selectedFields.includes(field.id)}
                      disabled={inserting}
                      id={`inheritance-confirm-${field.id}`}
                      onCheckedChange={(checked) =>
                        setSelectedFields((current) =>
                          checked
                            ? [...current, field.id]
                            : current.filter(
                                (candidate) => candidate !== field.id
                              )
                        )
                      }
                    />
                    <label htmlFor={`inheritance-confirm-${field.id}`}>
                      {field.label}
                    </label>
                  </div>
                ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">
                {creation_shelf_inheritance_guardrail()}
              </p>
              <Button
                disabled={selectedFields.length === 0 || inserting}
                onClick={() => void confirmInheritance()}
                type="button"
              >
                {inserting
                  ? creation_shelf_inserting()
                  : creation_shelf_confirm_inheritance({
                      count: selectedFields.length,
                    })}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={decompositionOpen} onOpenChange={setDecompositionOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{creation_shelf_decomposition_title()}</DialogTitle>
            <DialogDescription>
              {creation_shelf_decomposition_description()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            {(['official', 'user'] as const).map((value) => (
              <Button
                key={value}
                onClick={() => setSourceScope(value)}
                type="button"
                variant={sourceScope === value ? 'secondary' : 'outline'}
              >
                {value === 'official'
                  ? creation_shelf_official_library()
                  : creation_shelf_my_content()}
              </Button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {decompositionEntries.map((entry) => (
              <Button
                className="h-auto justify-start py-3 text-left"
                key={entry.key}
                onClick={() => {
                  setSelectedSource(entry);
                  setSelectedFields(inheritanceDefaults('decomposition'));
                }}
                type="button"
                variant={
                  selectedSource?.key === entry.key ? 'secondary' : 'outline'
                }
              >
                <span>
                  <span className="block font-medium">{entry.label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {entry.detail}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          {decompositionEntries.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {creation_shelf_no_decomposition_sources()}
            </p>
          ) : null}
          {selectedSource ? (
            <fieldset className="space-y-2 rounded-md border p-4">
              <legend className="px-1 text-sm font-medium">
                {creation_shelf_decomposition_legend()}
              </legend>
              {INHERITANCE_FIELD_OPTIONS.map((field) => (
                <div
                  className="flex min-h-touch-target items-center gap-3 text-sm"
                  key={field.id}
                >
                  <Checkbox
                    checked={selectedFields.includes(field.id)}
                    id={`decomposition-${field.id}`}
                    onCheckedChange={(checked) =>
                      setSelectedFields((current) =>
                        checked
                          ? [...current, field.id]
                          : current.filter(
                              (candidate) => candidate !== field.id
                            )
                      )
                    }
                  />
                  <label htmlFor={`decomposition-${field.id}`}>
                    {field.label}
                  </label>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {creation_shelf_decomposition_guardrail()}
              </p>
              <Button
                disabled={
                  selectedFields.length === 0 || !selectedSource.reference
                }
                onClick={async () => {
                  if (!selectedSource.reference) return;
                  try {
                    await onInsertReference(
                      referenceWithInheritance(
                        selectedSource.reference,
                        selectedFields
                      )
                    );
                    setDecompositionOpen(false);
                  } catch {
                    // The parent mutation keeps this confirmation available.
                  }
                }}
                type="button"
              >
                {creation_shelf_confirm_decomposition({
                  count: selectedFields.length,
                })}
              </Button>
            </fieldset>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
