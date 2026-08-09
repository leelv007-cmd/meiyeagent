/**
 * Admin notification centre — morph of ReUI app-shell-3 notifications popover.
 * Items projected from the same ops queries as the todo popover / pages.
 */
import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  admin_notifications_description,
  admin_notifications_empty,
  admin_notifications_exception_body,
  admin_notifications_exception_title,
  admin_notifications_pending_action_body,
  admin_notifications_pending_action_title,
  admin_notifications_refund_body,
  admin_notifications_refund_title,
  admin_notifications_title,
  admin_notifications_trigger_aria,
} from '@/locale/paraglide/messages';
import { getPathWithLocale } from '@/lib/urls';
import {
  IconAlertCircle,
  IconBell,
  IconChecklist,
  IconReceiptRefund,
} from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import {
  countUnreadAdminNotifications,
  projectAdminNotifications,
  type AdminNotificationItem,
} from './admin-notifications-model';
import { useAdminOpsHeaderQueries } from './use-admin-ops-header-queries';

function iconFor(item: AdminNotificationItem) {
  if (item.kind === 'refund-review') return IconReceiptRefund;
  if (item.kind === 'exception') return IconAlertCircle;
  return IconChecklist;
}

function variantClass(item: AdminNotificationItem) {
  if (item.variant === 'destructive') return 'text-destructive';
  if (item.variant === 'warning') return 'text-warning';
  return 'text-info';
}

export function AdminNotificationsPopover() {
  const navigate = useNavigate();
  const { exceptionView, pendingActions, refundReviews } =
    useAdminOpsHeaderQueries();

  const items = useMemo(
    () =>
      projectAdminNotifications({
        exceptionView,
        pendingActions: pendingActions.data,
        refundReviews: refundReviews.data,
        labels: {
          exceptionBody: (severity) =>
            admin_notifications_exception_body({ severity: severity }),
          exceptionTitle: (title) =>
            admin_notifications_exception_title({ title }),
          pendingActionBody: admin_notifications_pending_action_body(),
          pendingActionTitle: (kind) =>
            admin_notifications_pending_action_title({ kind }),
          refundBody: (orderId) => admin_notifications_refund_body({ orderId }),
          refundTitle: admin_notifications_refund_title(),
        },
      }),
    [exceptionView, pendingActions.data, refundReviews.data]
  );

  const unread = countUnreadAdminNotifications(items);

  return (
    <Popover>
      <PopoverTrigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            variant="outline"
            size="sm"
            className="relative h-7 gap-1.5 px-2"
            aria-label={admin_notifications_trigger_aria()}
            data-testid="admin-notifications-trigger"
          >
            <IconBell className="size-3.5" aria-hidden="true" />
            {unread > 0 ? (
              <Badge
                size="sm"
                variant="destructive-light"
                data-testid="admin-notifications-unread"
              >
                {unread}
              </Badge>
            ) : null}
          </Button>
        )}
      />
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-96 gap-0! space-y-0! p-0!"
        data-testid="admin-notifications-popover"
      >
        <PopoverHeader className="border-b px-3 py-2.5">
          <PopoverTitle className="text-xs font-medium">
            {admin_notifications_title()}
          </PopoverTitle>
          <PopoverDescription className="text-[11px]">
            {admin_notifications_description()}
          </PopoverDescription>
        </PopoverHeader>
        {items.length === 0 ? (
          <p
            className="text-muted-foreground px-3 py-8 text-center text-xs"
            data-testid="admin-notifications-empty"
          >
            {admin_notifications_empty()}
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y" data-testid="admin-notifications-list">
              {items.map((item) => {
                const Icon = iconFor(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="hover:bg-muted/50 flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors"
                      data-testid={`admin-notification-${item.kind}`}
                      onClick={() => {
                        void navigate({ to: getPathWithLocale(item.href) });
                      }}
                    >
                      <span
                        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center ${variantClass(item)}`}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block text-xs font-medium leading-snug">
                          {item.title}
                        </span>
                        <span className="text-muted-foreground block text-[11px] leading-snug">
                          {item.body}
                        </span>
                        {item.time ? (
                          <span className="text-muted-foreground block text-[10px] tabular-nums">
                            {item.time}
                          </span>
                        ) : null}
                      </span>
                      {item.unread ? (
                        <span
                          className="bg-primary mt-1 size-1.5 shrink-0 rounded-full"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
