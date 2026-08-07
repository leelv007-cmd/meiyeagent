import {
  admin_users_active,
  admin_users_admin,
  admin_users_ban_button,
  admin_users_bulk_ban,
  admin_users_bulk_unban,
  admin_users_clear_search,
  admin_users_columns_ban_expires,
  admin_users_columns_ban_reason,
  admin_users_columns_created_at,
  admin_users_columns_email,
  admin_users_columns_name,
  admin_users_columns_provisioned_by,
  admin_users_columns_role,
  admin_users_columns_status,
  admin_users_demote_merchant,
  admin_users_email_copied,
  admin_users_inactive,
  admin_users_no_results,
  admin_users_promote_admin,
  admin_users_row_actions,
  admin_users_search,
  admin_users_select_all,
  admin_users_select_row,
  admin_users_self_registered,
  admin_users_unban_button,
  admin_users_user,
  admin_users_view_details,
} from '@/locale/paraglide/messages';
import { UserNameLink } from '@/components/admin/users/user-name-link';
import {
  canBanUser,
  canSetPlatformRole,
  canUnbanUser,
  isPlatformAdmin,
} from '@/components/admin/users/user-action-predicates';
import {
  DataTableActionBar,
  DataTableActionBarAction,
  DataTableActionBarSelection,
} from '@/components/data-table/data-table-action-bar';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableFacetedFilter } from '@/components/data-table/data-table-faceted-filter';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameFooter, FramePanel } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminUserListItem } from '@/api/users';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  IconDots,
  IconEye,
  IconMailCheck,
  IconMailQuestion,
  IconUserCheck,
  IconUserDown,
  IconUserUp,
  IconUserX,
  IconX,
} from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatDateTime } from '@/lib/formatter';

function TableRowSkeleton({ columns }: { columns: number }) {
  return (
    <TableRow className="h-14">
      {Array.from({ length: columns }).map((_, i) => {
        if (i === 0) {
          return (
            <TableCell key={i} className="py-3">
              <Skeleton className="size-4 rounded" />
            </TableCell>
          );
        }
        if (i === 1) {
          return (
            <TableCell key={i} className="py-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-full shrink-0" />
                <Skeleton className="h-4 w-20" />
              </div>
            </TableCell>
          );
        }
        if (i === 2) {
          return (
            <TableCell key={i} className="py-3">
              <Skeleton className="h-6 w-32" />
            </TableCell>
          );
        }
        if (i === 3 || i === 5) {
          return (
            <TableCell key={i} className="py-3">
              <Skeleton className="h-6 w-16" />
            </TableCell>
          );
        }
        return (
          <TableCell key={i} className="py-3">
            <Skeleton className="h-4 w-24" />
          </TableCell>
        );
      })}
    </TableRow>
  );
}

function UsersRowActions({ user }: { user: AdminUserListItem }) {
  const banAllowed = canBanUser(user);
  const unbanAllowed = canUnbanUser(user);
  const roleAllowed = canSetPlatformRole(user);
  const isAdmin = isPlatformAdmin(user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={admin_users_row_actions()}
            data-testid="user-row-actions"
          />
        }
      >
        <IconDots className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuItem
            render={
              <Link
                to="/admin/users/$userId"
                params={{ userId: user.id }}
                data-testid="user-row-view-details"
              />
            }
          >
            <IconEye className="size-4" aria-hidden="true" />
            {admin_users_view_details()}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!banAllowed}
            data-testid="user-row-ban"
            render={
              banAllowed ? (
                <Link to="/admin/users/$userId" params={{ userId: user.id }} />
              ) : undefined
            }
          >
            <IconUserX className="size-4" aria-hidden="true" />
            {admin_users_ban_button()}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!unbanAllowed}
            data-testid="user-row-unban"
            render={
              unbanAllowed ? (
                <Link to="/admin/users/$userId" params={{ userId: user.id }} />
              ) : undefined
            }
          >
            <IconUserCheck className="size-4" aria-hidden="true" />
            {admin_users_unban_button()}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!roleAllowed}
            data-testid="user-row-role"
            render={
              roleAllowed ? (
                <Link to="/admin/users/$userId" params={{ userId: user.id }} />
              ) : undefined
            }
          >
            {isAdmin ? (
              <IconUserDown className="size-4" aria-hidden="true" />
            ) : (
              <IconUserUp className="size-4" aria-hidden="true" />
            )}
            {isAdmin
              ? admin_users_demote_merchant()
              : admin_users_promote_admin()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface UsersTableProps {
  data: AdminUserListItem[];
  total: number;
  pageIndex: number;
  pageSize: number;
  search: string;
  sorting: SortingState;
  filters?: ColumnFiltersState;
  loading?: boolean;
  actions?: ReactNode;
  onSearch: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortingChange: (sorting: SortingState) => void;
  onFiltersChange?: (filters: ColumnFiltersState) => void;
}

export function UsersTable({
  data,
  total,
  pageIndex,
  pageSize,
  search,
  sorting,
  filters = [],
  loading,
  actions,
  onSearch,
  onPageChange,
  onPageSizeChange,
  onSortingChange,
  onFiltersChange,
}: UsersTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const columns: ColumnDef<AdminUserListItem>[] = useMemo(
    () => [
      {
        id: 'select',
        enableHiding: false,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={
              table.getIsSomePageRowsSelected() &&
              !table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label={admin_users_select_all()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={admin_users_select_row()}
          />
        ),
        size: 40,
        minSize: 40,
      },
      {
        id: 'name',
        accessorKey: 'name',
        enableHiding: true,
        // The three sortable ids are exactly the server's SORT_FIELD_MAP keys
        // (src/api/users.ts); anything else would be silently coerced to
        // createdAt server-side, so those columns stay unsortable.
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_name()}
          />
        ),
        cell: ({ row }) => <UserNameLink user={row.original} />,
        meta: { label: admin_users_columns_name() },
        minSize: 120,
        size: 160,
      },
      {
        id: 'email',
        accessorKey: 'email',
        enableHiding: true,
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_email()}
          />
        ),
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                size="xl"
                className="border-transparent hover:cursor-pointer hover:underline hover:underline-offset-4"
                render={<button type="button" />}
                onClick={() => {
                  navigator.clipboard.writeText(u.email);
                  toast.success(admin_users_email_copied());
                }}
              >
                {u.emailVerified ? (
                  <IconMailCheck className="size-3.5 stroke-success" />
                ) : (
                  <IconMailQuestion className="size-3.5 stroke-destructive" />
                )}
                {u.email}
              </Badge>
            </div>
          );
        },
        meta: { label: admin_users_columns_email() },
        minSize: 180,
        size: 220,
      },
      {
        id: 'role',
        accessorKey: 'role',
        enableHiding: true,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_role()}
          />
        ),
        cell: ({ row }) => {
          const r = row.original.role ?? 'user';
          return (
            <Badge variant={r === 'admin' ? 'info-light' : 'secondary'}>
              {r === 'admin' ? admin_users_admin() : admin_users_user()}
            </Badge>
          );
        },
        meta: { label: admin_users_columns_role() },
        minSize: 100,
        size: 120,
      },
      {
        id: 'provisioningAttribution',
        accessorKey: 'provisioningAttribution',
        enableHiding: true,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_provisioned_by()}
          />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.provisioningAttribution.kind === 'admin_assisted'
              ? (row.original.provisioningAttribution.operatorDisplayName ??
                admin_users_admin())
              : admin_users_self_registered()}
          </span>
        ),
        meta: { label: admin_users_columns_provisioned_by() },
        minSize: 160,
        size: 200,
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        enableHiding: true,
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_created_at()}
          />
        ),
        cell: ({ row }) => formatDateTime(new Date(row.original.createdAt)),
        meta: { label: admin_users_columns_created_at() },
        minSize: 140,
        size: 160,
      },
      {
        id: 'status',
        accessorFn: (row) => (row.banned ? 'inactive' : 'active'),
        enableHiding: true,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_status()}
          />
        ),
        cell: ({ row }) => {
          const banned = row.original.banned;
          return (
            <Badge variant={banned ? 'destructive-light' : 'success-light'}>
              {banned ? (
                <>
                  <IconUserX className="size-3.5" />
                  {admin_users_inactive()}
                </>
              ) : (
                <>
                  <IconUserCheck className="size-3.5" />
                  {admin_users_active()}
                </>
              )}
            </Badge>
          );
        },
        meta: { label: admin_users_columns_status() },
        minSize: 100,
        size: 120,
      },
      {
        id: 'banReason',
        accessorKey: 'banReason',
        enableHiding: true,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_ban_reason()}
          />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.banReason ?? '-'}
          </span>
        ),
        meta: { label: admin_users_columns_ban_reason() },
        minSize: 120,
        size: 140,
      },
      {
        id: 'banExpires',
        accessorKey: 'banExpires',
        enableHiding: true,
        enableSorting: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            label={admin_users_columns_ban_expires()}
          />
        ),
        cell: ({ row }) => {
          const exp = row.original.banExpires;
          return (
            <span className="text-muted-foreground">
              {exp ? formatDate(new Date(exp)) : '-'}
            </span>
          );
        },
        meta: { label: admin_users_columns_ban_expires() },
        minSize: 140,
        size: 160,
      },
      {
        id: 'actions',
        enableHiding: false,
        enableSorting: false,
        header: () => null,
        cell: ({ row }) => <UsersRowActions user={row.original} />,
        size: 48,
        minSize: 48,
      },
    ],
    []
  );
  const roleFilterOptions = useMemo(
    () => [
      { label: admin_users_admin(), value: 'admin' },
      { label: admin_users_user(), value: 'user' },
    ],
    []
  );
  const statusFilterOptions = useMemo(
    () => [
      { label: admin_users_active(), value: 'active' },
      { label: admin_users_inactive(), value: 'inactive' },
    ],
    []
  );
  const table = useReactTable({
    data,
    columns,
    pageCount: Math.ceil(total / pageSize) || 1,
    state: {
      sorting,
      columnFilters: filters,
      columnVisibility,
      rowSelection,
      pagination: { pageIndex, pageSize },
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange(next);
    },
    onColumnFiltersChange: (updater) => {
      const next = typeof updater === 'function' ? updater(filters) : updater;
      onFiltersChange?.(next);
      onPageChange(0);
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex, pageSize })
          : updater;
      if (next.pageSize !== pageSize) {
        onPageSizeChange(next.pageSize);
        if (pageIndex !== 0) onPageChange(0);
      } else if (next.pageIndex !== pageIndex) {
        onPageChange(next.pageIndex);
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: true,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableMultiSort: false,
  });

  const selectedUsers = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original);
  const bulkBanAllowed =
    selectedUsers.length > 0 && selectedUsers.every((u) => canBanUser(u));
  const bulkUnbanAllowed =
    selectedUsers.length > 0 && selectedUsers.every((u) => canUnbanUser(u));

  return (
    <Frame dense className="w-full">
      <FramePanel className="p-0! shadow-none!">
        <div
          role="toolbar"
          aria-orientation="horizontal"
          className="flex flex-wrap items-center justify-between gap-2 px-(--frame-panel-header-px) py-(--frame-panel-header-py)"
        >
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative">
              <Input
                placeholder={admin_users_search()}
                value={search}
                onChange={(e) => {
                  onSearch(e.target.value);
                  onPageChange(0);
                }}
                className="h-8 w-[260px] pr-8"
              />
              {search.length > 0 ? (
                <button
                  type="button"
                  aria-label={admin_users_clear_search()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => {
                    onSearch('');
                    onPageChange(0);
                  }}
                >
                  <IconX className="size-3.5" />
                </button>
              ) : null}
            </div>
            <DataTableFacetedFilter
              column={table.getColumn('role')}
              title={admin_users_columns_role()}
              options={roleFilterOptions}
            />
            <DataTableFacetedFilter
              column={table.getColumn('status')}
              title={admin_users_columns_status()}
              options={statusFilterOptions}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DataTableViewOptions table={table} align="end" />
            {actions}
          </div>
        </div>
        <Separator />
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: pageSize }).map((_, i) => (
                  <TableRowSkeleton key={i} columns={columns.length} />
                ))
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    className="h-14"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-3">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    {admin_users_no_results()}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </FramePanel>
      <FrameFooter>
        <DataTablePagination table={table} className="px-0" />
      </FrameFooter>
      <DataTableActionBar table={table} data-testid="users-action-bar">
        <DataTableActionBarSelection table={table} />
        <DataTableActionBarAction
          disabled={!bulkBanAllowed}
          data-testid="users-bulk-ban"
        >
          {admin_users_bulk_ban()}
        </DataTableActionBarAction>
        <DataTableActionBarAction
          disabled={!bulkUnbanAllowed}
          data-testid="users-bulk-unban"
        >
          {admin_users_bulk_unban()}
        </DataTableActionBarAction>
      </DataTableActionBar>
    </Frame>
  );
}
