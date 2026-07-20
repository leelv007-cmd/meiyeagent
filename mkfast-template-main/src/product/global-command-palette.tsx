import {
  IconArrowRight,
  IconBolt,
  IconBriefcase,
  IconClipboardCheck,
  IconFile,
  IconHistory,
  IconPhoto,
  IconTemplate,
  IconVideo,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import {
  creation_shelf_owner_mine,
  creation_shelf_owner_official,
  global_command_add,
  global_command_catalog_error,
  global_command_catalog_error_value,
  global_command_creation_heading,
  global_command_creation_value,
  global_command_description,
  global_command_dialog_description,
  global_command_dialog_title,
  global_command_empty,
  global_command_navigation_heading,
  global_command_navigation_value,
  global_command_search_placeholder,
  global_command_shortcut,
  global_command_title,
  global_command_unavailable,
} from '@/locale/paraglide/messages';
import { Routes } from '@/lib/routes';
import { getPathWithLocale } from '@/lib/urls';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { CreativeWorkbenchProjection } from '@meiye/contracts';
import type { RawCanonicalHistory } from './canonical-history-model';
import {
  projectCreationCatalog,
  type CreationCatalogEntry,
  type CreationCatalogResponse,
} from './creation-catalog-model';
import { useCreativeToolAvailability } from './creative-tool-availability';
import {
  createPendingCreationAction,
  isGlobalCommandShortcut,
  parsePendingCreationAction,
  PENDING_CREATION_ACTION_STORAGE_KEY,
  projectGlobalNavigation,
  type GlobalNavigationEntry,
  type PendingCreationAction,
} from './global-command-model';

interface GlobalCommandContextValue {
  closePalette: () => void;
  consumePendingAction: (key: string) => void;
  open: boolean;
  openPalette: () => void;
  pendingAction?: PendingCreationAction;
  queuePendingAction: (entry: CreationCatalogEntry) => void;
}

const GlobalCommandContext = createContext<
  GlobalCommandContextValue | undefined
>(undefined);

export function useGlobalCommand() {
  const value = useContext(GlobalCommandContext);
  if (!value) {
    throw new Error(
      'useGlobalCommand must be used inside GlobalCommandProvider'
    );
  }
  return value;
}

function iconForNavigation(entry: GlobalNavigationEntry) {
  if (entry.kind === 'task') return IconClipboardCheck;
  if (entry.kind === 'session') return IconHistory;
  if (entry.kind === 'job') return IconBriefcase;
  return IconArrowRight;
}

function iconForCreation(entry: CreationCatalogEntry) {
  if (entry.kind === 'template') return IconTemplate;
  if (entry.operation === 'image.generate') return IconPhoto;
  if (entry.operation === 'video.generate') return IconVideo;
  if (entry.kind === 'tool') return IconBolt;
  return IconFile;
}

function GlobalCommandPalette() {
  const navigate = useNavigate();
  const { closePalette, open, openPalette, queuePendingAction } =
    useGlobalCommand();
  const catalog = useQuery({
    enabled: open,
    queryKey: p1QueryKeys.request('operations', 'creation_catalog'),
    queryFn: ({ signal }) =>
      operationsQuery<CreationCatalogResponse>('creation_catalog', {}, signal),
  });
  const history = useQuery({
    enabled: open,
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
  });
  const workbench = useQuery({
    enabled: open,
    queryKey: p1QueryKeys.request('operations', 'creative_workbench'),
    queryFn: ({ signal }) =>
      operationsQuery<CreativeWorkbenchProjection>(
        'creative_workbench',
        {},
        signal
      ),
  });
  const toolCatalog = useCreativeToolAvailability(open);
  const navigationEntries = useMemo(
    () => projectGlobalNavigation(history.data),
    [history.data]
  );
  const creationEntries = useMemo(() => {
    const currentWork = [...(workbench.data?.works ?? [])].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )[0];
    return projectCreationCatalog(
      catalog.data,
      history.data,
      toolCatalog.availability,
      {
        currentWorkId: currentWork?.id,
        sourceReferences: currentWork?.sourceReferences,
      }
    );
  }, [catalog.data, history.data, toolCatalog.availability, workbench.data]);

  const go = (entry: GlobalNavigationEntry) => {
    closePalette();
    void navigate({ to: getPathWithLocale(entry.href) });
  };
  const add = (entry: CreationCatalogEntry) => {
    if (!entry.available) return;
    queuePendingAction(entry);
    closePalette();
    void navigate({ to: getPathWithLocale(Routes.Dashboard) });
  };

  return (
    <CommandDialog
      description={global_command_dialog_description()}
      onOpenChange={(nextOpen) => (nextOpen ? openPalette() : closePalette())}
      open={open}
      title={global_command_dialog_title()}
    >
      <Command className="p-0">
        <div className="border-b px-4 py-3">
          <p className="font-medium">{global_command_title()}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {global_command_description()}
          </p>
        </div>
        <div className="relative border-b px-2 py-2">
          <CommandInput
            autoFocus
            className="pr-12"
            placeholder={global_command_search_placeholder()}
          />
          <Kbd className="absolute top-1/2 right-4 -translate-y-1/2 border border-border bg-background px-1.5 text-xs shadow-xs">
            ⌘K
          </Kbd>
        </div>
        <CommandList className="max-h-80 scroll-py-2 py-2">
          <CommandEmpty className="py-10 text-muted-foreground">
            {global_command_empty()}
          </CommandEmpty>
          <CommandGroup
            className="p-0 pb-2 **:[[cmdk-group-heading]]:mb-2 **:[[cmdk-group-heading]]:bg-muted/60 **:[[cmdk-group-heading]]:px-4 **:[[cmdk-group-heading]]:py-2.5 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-foreground [&_[cmdk-group-items]]:space-y-1 [&_[cmdk-group-items]]:px-2"
            heading={global_command_navigation_heading()}
          >
            {navigationEntries.map((entry) => {
              const Icon = iconForNavigation(entry);
              return (
                <CommandItem
                  key={`${entry.kind}:${entry.id}`}
                  value={global_command_navigation_value({
                    detail: entry.detail,
                    kind: entry.kind,
                    label: entry.label,
                  })}
                  className="items-start gap-3 px-3 py-2.5"
                  onSelect={() => go(entry)}
                >
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-5 text-muted-foreground group-data-selected/command-item:text-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {entry.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.detail}
                    </span>
                  </span>
                  <CommandShortcut className="self-center tracking-normal">
                    <Kbd className="border border-border bg-background shadow-xs group-data-selected/command-item:border-foreground/20">
                      {entry.actionLabel}
                    </Kbd>
                  </CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandGroup
            className="border-t border-border p-0 pt-2 **:[[cmdk-group-heading]]:mb-2 **:[[cmdk-group-heading]]:bg-muted/60 **:[[cmdk-group-heading]]:px-4 **:[[cmdk-group-heading]]:py-2.5 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-foreground [&_[cmdk-group-items]]:space-y-1 [&_[cmdk-group-items]]:px-2"
            heading={global_command_creation_heading()}
          >
            {creationEntries.map((entry) => {
              const Icon = iconForCreation(entry);
              return (
                <CommandItem
                  key={entry.key}
                  disabled={!entry.available}
                  value={global_command_creation_value({
                    detail: entry.detail,
                    label: entry.label,
                    tags: entry.tags.join(' '),
                  })}
                  className="items-start gap-3 px-3 py-2.5"
                  onSelect={() => add(entry)}
                >
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-5 text-muted-foreground group-data-selected/command-item:text-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {entry.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {entry.unavailableReason ?? entry.detail}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline">
                        {entry.owner === 'official'
                          ? creation_shelf_owner_official()
                          : creation_shelf_owner_mine()}
                      </Badge>
                      {entry.shortcut ? (
                        <Badge variant="secondary">
                          {global_command_shortcut()}
                        </Badge>
                      ) : null}
                      {entry.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  </span>
                  <CommandShortcut className="self-center tracking-normal">
                    <Kbd className="border border-border bg-background shadow-xs group-data-selected/command-item:border-foreground/20">
                      {entry.available
                        ? global_command_add()
                        : global_command_unavailable()}
                    </Kbd>
                  </CommandShortcut>
                </CommandItem>
              );
            })}
            {catalog.isError || history.isError ? (
              <CommandItem
                disabled
                value={global_command_catalog_error_value()}
              >
                <IconFile aria-hidden="true" />
                <span>{global_command_catalog_error()}</span>
              </CommandItem>
            ) : null}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function GlobalCommandProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingCreationAction>();
  const focusReturn = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPendingAction(
      parsePendingCreationAction(
        sessionStorage.getItem(PENDING_CREATION_ACTION_STORAGE_KEY)
      )
    );
  }, []);

  const openPalette = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      focusReturn.current = document.activeElement;
    }
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setOpen(false);
    queueMicrotask(() => focusReturn.current?.focus());
  }, []);
  const queuePendingAction = useCallback((entry: CreationCatalogEntry) => {
    if (!entry.available) return;
    const action = createPendingCreationAction(entry);
    setPendingAction(action);
    sessionStorage.setItem(
      PENDING_CREATION_ACTION_STORAGE_KEY,
      JSON.stringify(action)
    );
  }, []);
  const consumePendingAction = useCallback((key: string) => {
    setPendingAction((current) => (current?.key === key ? undefined : current));
    const stored = parsePendingCreationAction(
      sessionStorage.getItem(PENDING_CREATION_ACTION_STORAGE_KEY)
    );
    if (stored?.key === key) {
      sessionStorage.removeItem(PENDING_CREATION_ACTION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (isGlobalCommandShortcut(event)) {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', onShortcut);
    document.documentElement.dataset.globalCommandReady = 'true';
    return () => {
      window.removeEventListener('keydown', onShortcut);
      delete document.documentElement.dataset.globalCommandReady;
    };
  }, [openPalette]);

  const value = useMemo<GlobalCommandContextValue>(
    () => ({
      closePalette,
      consumePendingAction,
      open,
      openPalette,
      pendingAction,
      queuePendingAction,
    }),
    [
      closePalette,
      consumePendingAction,
      open,
      openPalette,
      pendingAction,
      queuePendingAction,
    ]
  );

  return (
    <GlobalCommandContext value={value}>
      {children}
      <GlobalCommandPalette />
    </GlobalCommandContext>
  );
}
