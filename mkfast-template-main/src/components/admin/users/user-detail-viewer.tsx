import {
  admin_users_active,
  admin_users_admin,
  admin_users_ban_button,
  admin_users_ban_default_reason,
  admin_users_ban_error,
  admin_users_ban_expires,
  admin_users_ban_never,
  admin_users_ban_reason,
  admin_users_ban_reason_placeholder,
  admin_users_ban_select_date,
  admin_users_ban_success,
  admin_users_banned,
  admin_users_close,
  admin_users_columns_email,
  admin_users_columns_provisioned_by,
  admin_users_demote_merchant,
  admin_users_detail_account_title,
  admin_users_detail_back,
  admin_users_detail_error,
  admin_users_detail_error_description,
  admin_users_detail_loading,
  admin_users_detail_not_found,
  admin_users_detail_not_found_description,
  admin_users_detail_summary_title,
  admin_users_email_copied,
  admin_users_joined,
  admin_users_promote_admin,
  admin_users_role_error,
  admin_users_role_last_admin_error,
  admin_users_role_reason,
  admin_users_role_reason_placeholder,
  admin_users_role_reason_required,
  admin_users_role_recent_auth_error,
  admin_users_role_section_title,
  admin_users_role_success,
  admin_users_self_registered,
  admin_users_unban_button,
  admin_users_unban_error,
  admin_users_unban_success,
  admin_users_updated,
  admin_users_user,
} from '@/locale/paraglide/messages';
import type { AdminUserListItem } from '@/api/users';
import {
  canBanUser,
  canSetPlatformRole,
  canUnbanUser,
  isPlatformAdmin,
} from '@/components/admin/users/user-action-predicates';
import { useRouteSheet } from '@/components/admin/shared/use-route-sheet';
import { UserAvatar } from '@/components/shared/user-avatar';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { FieldError, FieldLabel } from '@/components/ui/field';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  SetPlatformRoleError,
  useBanUser,
  useSetPlatformRole,
  useUnbanUser,
} from '@/hooks/use-users';
import { formatDate } from '@/lib/formatter';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  IconAlertTriangle,
  IconCalendar,
  IconLoader2,
  IconMailCheck,
  IconMailQuestion,
  IconPackageOff,
  IconUserCheck,
  IconUserX,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

const FRAME_PANEL_RESET = 'shadow-none!';

const SHEET_CONTENT_CLASS =
  'flex flex-col gap-0 overflow-hidden rounded-xl p-0 outline-none data-[side=right]:inset-y-4 data-[side=right]:right-4 data-[side=right]:left-auto data-[side=right]:h-[calc(100svh-2rem)] data-[side=right]:w-[min(56rem,calc(100vw-2rem))] data-[side=right]:max-w-none data-[side=right]:sm:max-w-none';

function toDate(v: Date | string | number | null | undefined): Date | null {
  return v ? new Date(v) : null;
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

/**
 * Detail body + write paths (role / ban). Mutation signatures match the
 * previous uncontrolled sheet — only the host chrome moved to the route.
 */
export function UserDetailPanel({ user }: { user: AdminUserListItem }) {
  const [error, setError] = useState<string | undefined>();
  const [roleError, setRoleError] = useState<string | undefined>();
  const [banReason, setBanReason] = useState<string>(
    admin_users_ban_default_reason()
  );
  const [roleReason, setRoleReason] = useState('');
  const [banExpiresAt, setBanExpiresAt] = useState<Date | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const banUserMutation = useBanUser();
  const unbanUserMutation = useUnbanUser();
  const setPlatformRoleMutation = useSetPlatformRole();

  const isAdmin = isPlatformAdmin(user);
  const targetRole = isAdmin ? 'user' : 'admin';
  const roleChangeAllowed = canSetPlatformRole(user);
  const banAllowed = canBanUser(user);
  const unbanAllowed = canUnbanUser(user);

  const handleRoleChange = async () => {
    if (!user.id) {
      setRoleError(admin_users_role_error());
      return;
    }
    const reason = roleReason.trim();
    if (!reason) {
      setRoleError(admin_users_role_reason_required());
      return;
    }
    setRoleError(undefined);
    try {
      await setPlatformRoleMutation.mutateAsync({
        userId: user.id,
        role: targetRole,
        reason,
      });
      toast.success(admin_users_role_success());
      setRoleReason('');
    } catch (err) {
      let msg: string = admin_users_role_error();
      if (err instanceof SetPlatformRoleError) {
        if (err.code === 'RECENT_AUTHENTICATION_REQUIRED') {
          msg = admin_users_role_recent_auth_error();
        } else if (err.code === 'LAST_ADMIN_REQUIRED') {
          msg = admin_users_role_last_admin_error();
        } else if (err.code === 'REASON_REQUIRED') {
          msg = admin_users_role_reason_required();
        }
      }
      setRoleError(msg);
      toast.error(msg);
    }
  };

  const handleBan = async () => {
    if (!banReason?.trim()) {
      setError(admin_users_ban_error());
      return;
    }
    if (!user.id) {
      setError(admin_users_ban_error());
      return;
    }
    setError(undefined);
    try {
      await banUserMutation.mutateAsync({
        userId: user.id,
        banReason: banReason.trim(),
        banExpiresIn: banExpiresAt
          ? Math.floor((banExpiresAt.getTime() - Date.now()) / 1000)
          : undefined,
      });
      toast.success(admin_users_ban_success());
      setBanReason(admin_users_ban_default_reason());
      setBanExpiresAt(undefined);
    } catch {
      const msg = admin_users_ban_error();
      setError(msg);
      toast.error(msg);
    }
  };
  const handleUnban = async () => {
    if (!user.id) {
      setError(admin_users_unban_error());
      return;
    }
    setError(undefined);
    try {
      await unbanUserMutation.mutateAsync({ userId: user.id });
      toast.success(admin_users_unban_success());
    } catch {
      const msg = admin_users_unban_error();
      setError(msg);
      toast.error(msg);
    }
  };

  const provisionedBy =
    user.provisioningAttribution.kind === 'admin_assisted'
      ? (user.provisioningAttribution.operatorDisplayName ??
        admin_users_admin())
      : admin_users_self_registered();

  const accountSection = (
    <Frame dense spacing="sm" className="w-full">
      <FrameHeader>
        <FrameTitle>{admin_users_detail_account_title()}</FrameTitle>
      </FrameHeader>
      <FramePanel className={cn('flex flex-col gap-3', FRAME_PANEL_RESET)}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={user.role === 'admin' ? 'info-light' : 'secondary'}>
            {user.role === 'admin' ? admin_users_admin() : admin_users_user()}
          </Badge>
          <Badge variant={user.banned ? 'destructive-light' : 'success-light'}>
            {user.banned ? (
              <>
                <IconUserX className="size-3.5" />
                {admin_users_banned()}
              </>
            ) : (
              <>
                <IconUserCheck className="size-3.5" />
                {admin_users_active()}
              </>
            )}
          </Badge>
        </div>
        {user.email && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {admin_users_columns_email()}
            </span>
            <Badge
              variant="outline"
              size="xl"
              className="w-fit border-transparent hover:cursor-pointer hover:underline hover:underline-offset-4"
              render={<button type="button" />}
              onClick={() => {
                navigator.clipboard.writeText(user.email);
                toast.success(admin_users_email_copied());
              }}
            >
              {user.emailVerified ? (
                <IconMailCheck className="size-3.5 stroke-success" />
              ) : (
                <IconMailQuestion className="size-3.5 stroke-destructive" />
              )}
              {user.email}
            </Badge>
          </div>
        )}
      </FramePanel>
    </Frame>
  );

  const roleSection = (
    <Frame dense spacing="sm" className="w-full">
      <FrameHeader>
        <FrameTitle>{admin_users_role_section_title()}</FrameTitle>
      </FrameHeader>
      <FramePanel className={cn('flex flex-col gap-4', FRAME_PANEL_RESET)}>
        {roleError && <FieldError>{roleError}</FieldError>}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isAdmin ? 'info-light' : 'secondary'}>
            {isAdmin ? admin_users_admin() : admin_users_user()}
          </Badge>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="role-change-reason">
            {admin_users_role_reason()}
          </FieldLabel>
          <Textarea
            id="role-change-reason"
            value={roleReason}
            onChange={(e) => setRoleReason(e.target.value)}
            placeholder={admin_users_role_reason_placeholder()}
            required
          />
        </div>
        <Button
          type="button"
          variant={isAdmin ? 'outline' : 'default'}
          onClick={handleRoleChange}
          disabled={
            setPlatformRoleMutation.isPending ||
            !roleReason.trim() ||
            !roleChangeAllowed
          }
          data-testid="user-role-change"
        >
          {setPlatformRoleMutation.isPending && (
            <IconLoader2 className="mr-2 size-4 animate-spin" />
          )}
          {isAdmin
            ? admin_users_demote_merchant()
            : admin_users_promote_admin()}
        </Button>
      </FramePanel>
    </Frame>
  );

  const banSection = (
    <Frame dense spacing="sm" className="w-full">
      <FrameHeader>
        <FrameTitle>
          {user.banned ? admin_users_banned() : admin_users_ban_button()}
        </FrameTitle>
      </FrameHeader>
      <FramePanel className={cn('flex flex-col gap-4', FRAME_PANEL_RESET)}>
        {error && <FieldError>{error}</FieldError>}
        {user.banned ? (
          <div className="flex flex-col gap-2 text-sm">
            {user.banReason && (
              <SummaryRow
                label={admin_users_ban_reason()}
                value={user.banReason}
              />
            )}
            <SummaryRow
              label={admin_users_ban_expires()}
              value={
                user.banExpires && toDate(user.banExpires)
                  ? formatDate(toDate(user.banExpires)!)
                  : admin_users_ban_never()
              }
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="ban-reason">
                {admin_users_ban_reason()}
              </FieldLabel>
              <Textarea
                id="ban-reason"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder={admin_users_ban_reason_placeholder()}
                required
              />
            </div>
            <div className="flex w-fit max-w-full flex-col gap-1.5">
              <FieldLabel>{admin_users_ban_expires()}</FieldLabel>
              <div className="w-fit rounded-lg border border-input bg-background">
                <button
                  type="button"
                  onClick={() => setCalendarOpen((o) => !o)}
                  className={cn(
                    'flex h-9 w-full items-center justify-start gap-1.5 px-2.5 text-sm font-normal outline-none hover:bg-muted hover:text-foreground rounded-lg',
                    !banExpiresAt && 'text-muted-foreground'
                  )}
                >
                  <IconCalendar className="size-4 shrink-0" />
                  {banExpiresAt ? (
                    formatDate(banExpiresAt)
                  ) : (
                    <span>{admin_users_ban_select_date()}</span>
                  )}
                </button>
                {calendarOpen && (
                  <div className="w-auto border-t border-input p-2">
                    <Calendar
                      mode="single"
                      selected={banExpiresAt}
                      onSelect={(date) => {
                        setBanExpiresAt(date);
                        setCalendarOpen(false);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </FramePanel>
    </Frame>
  );

  const summarySection = (
    <Frame dense spacing="sm" className="w-full">
      <FrameHeader>
        <FrameTitle>{admin_users_detail_summary_title()}</FrameTitle>
      </FrameHeader>
      <FramePanel
        className={cn('flex flex-col gap-2 text-sm', FRAME_PANEL_RESET)}
      >
        <SummaryRow
          label={admin_users_columns_provisioned_by()}
          value={<span className="font-mono text-xs">{provisionedBy}</span>}
        />
        <SummaryRow
          label={admin_users_joined()}
          value={
            toDate(user.createdAt) ? formatDate(toDate(user.createdAt)!) : '-'
          }
        />
        <SummaryRow
          label={admin_users_updated()}
          value={
            toDate(user.updatedAt) ? formatDate(toDate(user.updatedAt)!) : '-'
          }
        />
      </FramePanel>
    </Frame>
  );

  const leftContent = (
    <div className="flex flex-col gap-4 px-5 py-4 sm:px-6">
      {accountSection}
      {roleSection}
      {banSection}
    </div>
  );

  const rightContent = (
    <div className="flex flex-col gap-4 px-5 py-4 sm:px-6">
      {summarySection}
    </div>
  );

  return (
    <>
      <SheetHeader className="shrink-0 border-b px-5 py-4 sm:px-6">
        <div className="flex items-center gap-4">
          <UserAvatar
            name={user.name ?? null}
            image={user.image ?? null}
            className="size-12 border"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="truncate">{user.name}</SheetTitle>
              <Badge
                variant={user.banned ? 'destructive-light' : 'success-light'}
              >
                {user.banned ? admin_users_banned() : admin_users_active()}
              </Badge>
            </div>
            <SheetDescription>
              {admin_users_joined()}
              {': '}
              {toDate(user.createdAt)
                ? formatDate(toDate(user.createdAt)!)
                : '-'}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 lg:hidden">
        <ScrollArea className="h-full">
          {leftContent}
          <Separator />
          {rightContent}
        </ScrollArea>
      </div>

      <div className="hidden min-h-0 flex-1 flex-row lg:flex">
        <div className="min-h-0 min-w-0 flex-1">
          <ScrollArea className="h-full">{leftContent}</ScrollArea>
        </div>
        <Separator orientation="vertical" className="self-stretch" />
        <div className="min-h-0 w-[320px] shrink-0">
          <ScrollArea className="h-full">{rightContent}</ScrollArea>
        </div>
      </div>

      <SheetFooter className="shrink-0 flex-row items-center justify-end gap-2 border-t bg-muted/40 px-5 py-4 sm:px-6">
        <SheetClose render={<Button type="button" variant="outline" />}>
          {admin_users_close()}
        </SheetClose>
        {user.banned ? (
          <Button
            variant="destructive"
            onClick={handleUnban}
            disabled={unbanUserMutation.isPending || !unbanAllowed}
            data-testid="user-unban"
          >
            {unbanUserMutation.isPending && (
              <IconLoader2 className="mr-2 size-4 animate-spin" />
            )}
            {admin_users_unban_button()}
          </Button>
        ) : (
          <Button
            variant="destructive"
            onClick={handleBan}
            disabled={
              banUserMutation.isPending || !banReason?.trim() || !banAllowed
            }
            data-testid="user-ban"
          >
            {banUserMutation.isPending && (
              <IconLoader2 className="mr-2 size-4 animate-spin" />
            )}
            {admin_users_ban_button()}
          </Button>
        )}
      </SheetFooter>
    </>
  );
}

/** Route-owned detail sheet: close = navigate back to the users list. */
export function UserDetailSheet({ user }: { user: AdminUserListItem }) {
  const navigate = useNavigate();
  const handleClosed = useCallback(() => {
    void navigate({ to: '/admin/users' });
  }, [navigate]);
  const sheet = useRouteSheet(handleClosed);

  return (
    <Sheet {...sheet}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={SHEET_CONTENT_CLASS}
        data-testid="user-detail-sheet"
      >
        <UserDetailPanel user={user} />
      </SheetContent>
    </Sheet>
  );
}

/** Shared chrome for pending / not-found / error so they overlay the list. */
export function UserDetailStateSheet({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const handleClosed = useCallback(() => {
    void navigate({ to: '/admin/users' });
  }, [navigate]);
  const sheet = useRouteSheet(handleClosed);

  return (
    <Sheet {...sheet}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={SHEET_CONTENT_CLASS}
        data-testid="user-detail-state-sheet"
      >
        <SheetHeader className="shrink-0 border-b px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="truncate">
              {admin_users_detail_account_title()}
            </SheetTitle>
            <SheetClose
              render={
                <Button type="button" variant="outline" size="sm">
                  {admin_users_close()}
                </Button>
              }
            />
          </div>
          <SheetDescription className="sr-only">
            {admin_users_detail_account_title()}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function UserDetailLoadingState() {
  return (
    <UserDetailStateSheet>
      <div className="flex flex-col items-center gap-3 text-center">
        <IconLoader2
          className="size-10 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          {admin_users_detail_loading()}
        </p>
      </div>
    </UserDetailStateSheet>
  );
}

export function UserDetailNotFoundState() {
  return (
    <UserDetailStateSheet>
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <IconPackageOff
          className="size-10 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            {admin_users_detail_not_found()}
          </p>
          <p className="text-sm text-muted-foreground">
            {admin_users_detail_not_found_description()}
          </p>
        </div>
        <Link
          to="/admin/users"
          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
        >
          {admin_users_detail_back()}
        </Link>
      </div>
    </UserDetailStateSheet>
  );
}

export function UserDetailErrorState() {
  return (
    <UserDetailStateSheet>
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <IconAlertTriangle
          className="size-10 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">
            {admin_users_detail_error()}
          </p>
          <p className="text-sm text-muted-foreground">
            {admin_users_detail_error_description()}
          </p>
        </div>
        <Link
          to="/admin/users"
          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
        >
          {admin_users_detail_back()}
        </Link>
      </div>
    </UserDetailStateSheet>
  );
}
