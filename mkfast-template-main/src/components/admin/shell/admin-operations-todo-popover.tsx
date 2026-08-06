/**
 * Header ops-todo aggregate popover — morph of ReUI app-shell-7 system monitor.
 * Counts reuse page queries (pending-actions / refund review / exceptions).
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
import { Separator } from '@/components/ui/separator';
import {
  admin_ops_todo_description,
  admin_ops_todo_empty,
  admin_ops_todo_exceptions,
  admin_ops_todo_loading,
  admin_ops_todo_open,
  admin_ops_todo_pending_actions,
  admin_ops_todo_refund_review,
  admin_ops_todo_title,
  admin_ops_todo_total,
  admin_ops_todo_trigger,
  admin_ops_todo_trigger_aria,
} from '@/locale/paraglide/messages';
import { getPathWithLocale } from '@/lib/urls';
import {
  IconAlertTriangle,
  IconChecklist,
  IconReceiptRefund,
} from '@tabler/icons-react';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import {
  buildAdminOperationsTodoItems,
  sumAdminOperationsTodoCounts,
  type AdminOperationsTodoItem,
} from './admin-operations-todo-model';
import { useAdminOpsHeaderQueries } from './use-admin-ops-header-queries';

const ITEM_META: Record<
  AdminOperationsTodoItem['id'],
  { icon: typeof IconChecklist; label: () => string }
> = {
  'pending-actions': {
    icon: IconChecklist,
    label: admin_ops_todo_pending_actions,
  },
  'refund-review': {
    icon: IconReceiptRefund,
    label: admin_ops_todo_refund_review,
  },
  exceptions: {
    icon: IconAlertTriangle,
    label: admin_ops_todo_exceptions,
  },
};

export function AdminOperationsTodoPopover() {
  const navigate = useNavigate();
  const { exceptionView, isLoading, pendingActions, refundReviews } =
    useAdminOpsHeaderQueries();

  const items = useMemo(
    () =>
      buildAdminOperationsTodoItems({
        exceptionView,
        pendingActions: pendingActions.data,
        refundReviews: refundReviews.data,
      }),
    [exceptionView, pendingActions.data, refundReviews.data]
  );

  const total = sumAdminOperationsTodoCounts(items);
  const hasWork = total > 0;

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
            aria-label={admin_ops_todo_trigger_aria()}
            data-testid="admin-ops-todo-trigger"
          >
            <IconChecklist className="size-3.5" aria-hidden="true" />
            <span className="hidden text-xs font-medium sm:inline">
              {admin_ops_todo_trigger()}
            </span>
            {hasWork ? (
              <Badge
                size="sm"
                variant="warning-light"
                data-testid="admin-ops-todo-total"
              >
                {total}
              </Badge>
            ) : null}
          </Button>
        )}
      />
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 gap-0! space-y-0! p-0!"
        data-testid="admin-ops-todo-popover"
      >
        <PopoverHeader className="border-b px-3 py-2.5">
          <PopoverTitle className="text-xs font-medium">
            {admin_ops_todo_title()}
          </PopoverTitle>
          <PopoverDescription className="text-[11px]">
            {isLoading
              ? admin_ops_todo_loading()
              : hasWork
                ? admin_ops_todo_total({ count: String(total) })
                : admin_ops_todo_empty()}
          </PopoverDescription>
        </PopoverHeader>
        <p className="text-muted-foreground border-b px-3 py-2 text-[11px]">
          {admin_ops_todo_description()}
        </p>
        <ul className="divide-y" data-testid="admin-ops-todo-list">
          {items.map((item) => {
            const meta = ITEM_META[item.id];
            const Icon = meta.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="hover:bg-muted/50 flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                  data-testid={`admin-ops-todo-item-${item.id}`}
                  data-count={item.count}
                  onClick={() => {
                    void navigate({ to: getPathWithLocale(item.href) });
                  }}
                >
                  <span className="bg-muted flex size-7 items-center justify-center rounded-md">
                    <Icon className="size-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">
                      {meta.label()}
                    </span>
                    <span className="text-muted-foreground block text-[11px]">
                      {admin_ops_todo_open()}
                    </span>
                  </span>
                  <Badge
                    size="sm"
                    variant={item.count > 0 ? 'warning-light' : 'outline'}
                    data-testid={`admin-ops-todo-count-${item.id}`}
                  >
                    {item.count}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>
        <Separator />
      </PopoverContent>
    </Popover>
  );
}
