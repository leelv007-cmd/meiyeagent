/**
 * Admin ⌘K command palette — morph of ReUI app-shell-3 search dialog +
 * existing product cmdk Command primitives. Search source: six-domain nav +
 * recordable admin destinations (admin-command-model).
 */
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
import { Kbd } from '@/components/ui/kbd';
import {
  admin_command_description,
  admin_command_dialog_description,
  admin_command_dialog_title,
  admin_command_empty,
  admin_command_entities_heading,
  admin_command_navigation_heading,
  admin_command_placeholder,
  admin_command_title,
} from '@/locale/paraglide/messages';
import { getPathWithLocale } from '@/lib/urls';
import { IconArrowRight, IconDatabase } from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import {
  buildAdminCommandEntries,
  type AdminCommandEntry,
} from './admin-command-model';

function isAdminCommandShortcut(event: KeyboardEvent) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.key.toLowerCase() === 'k'
  );
}

export function AdminCommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => buildAdminCommandEntries(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAdminCommandShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    document.documentElement.dataset.adminCommandReady = 'true';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      delete document.documentElement.dataset.adminCommandReady;
    };
  }, []);

  const go = (entry: AdminCommandEntry) => {
    setOpen(false);
    void navigate({ to: getPathWithLocale(entry.href) });
  };

  const navigationEntries = entries.filter(
    (entry) => entry.kind === 'navigation'
  );
  const entityEntries = entries.filter((entry) => entry.kind === 'entity');

  return (
    <CommandDialog
      description={admin_command_dialog_description()}
      onOpenChange={setOpen}
      open={open}
      title={admin_command_dialog_title()}
      data-testid="admin-command-dialog"
    >
      <Command className="p-0" data-testid="admin-command-palette">
        <div className="border-b px-4 py-3">
          <p className="font-medium">{admin_command_title()}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {admin_command_description()}
          </p>
        </div>
        <div className="relative border-b px-2 py-2">
          <CommandInput
            autoFocus
            className="pr-12"
            placeholder={admin_command_placeholder()}
            data-testid="admin-command-input"
          />
          <Kbd className="absolute top-1/2 right-4 -translate-y-1/2 border border-border bg-background px-1.5 text-xs shadow-xs">
            ⌘K
          </Kbd>
        </div>
        <CommandList className="max-h-80 scroll-py-2 py-2">
          <CommandEmpty className="py-10 text-muted-foreground">
            {admin_command_empty()}
          </CommandEmpty>
          <CommandGroup
            className="p-0 pb-2 **:[[cmdk-group-heading]]:mb-2 **:[[cmdk-group-heading]]:bg-muted/60 **:[[cmdk-group-heading]]:px-4 **:[[cmdk-group-heading]]:py-2.5 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-foreground [&_[cmdk-group-items]]:space-y-1 [&_[cmdk-group-items]]:px-2"
            heading={admin_command_navigation_heading()}
          >
            {navigationEntries.map((entry) => (
              <CommandItem
                key={`nav:${entry.id}`}
                value={`${entry.label} ${entry.keywords}`}
                className="items-start gap-3 px-3 py-2.5"
                data-testid={`admin-command-item-${entry.id}`}
                onSelect={() => go(entry)}
              >
                <IconArrowRight
                  aria-hidden="true"
                  className="mt-0.5 size-4 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {entry.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.groupLabel}
                  </span>
                </span>
                <CommandShortcut className="self-center tracking-normal">
                  <Kbd className="border border-border bg-background shadow-xs">
                    ↵
                  </Kbd>
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup
            className="border-t border-border p-0 pt-2 **:[[cmdk-group-heading]]:mb-2 **:[[cmdk-group-heading]]:bg-muted/60 **:[[cmdk-group-heading]]:px-4 **:[[cmdk-group-heading]]:py-2.5 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:text-foreground [&_[cmdk-group-items]]:space-y-1 [&_[cmdk-group-items]]:px-2"
            heading={admin_command_entities_heading()}
          >
            {entityEntries.map((entry) => (
              <CommandItem
                key={`entity:${entry.id}`}
                value={`${entry.label} ${entry.keywords} entity record`}
                className="items-start gap-3 px-3 py-2.5"
                data-testid={`admin-command-entity-${entry.id}`}
                onSelect={() => go(entry)}
              >
                <IconDatabase
                  aria-hidden="true"
                  className="mt-0.5 size-4 text-muted-foreground"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {entry.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.href}
                  </span>
                </span>
                <CommandShortcut className="self-center tracking-normal">
                  <Kbd className="border border-border bg-background shadow-xs">
                    ↵
                  </Kbd>
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
