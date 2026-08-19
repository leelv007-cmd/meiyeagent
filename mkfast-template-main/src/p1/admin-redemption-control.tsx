/**
 * Td-4: platform admin redemption code management.
 * Calls the redemptions P1 module; the list follows the shared admin data-grid
 * rhythm (toolbar / table / footer) and recording a code runs in a form sheet.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IconPlus } from '@tabler/icons-react';
import {
  admin_redemption_actions,
  admin_redemption_code,
  admin_redemption_code_placeholder,
  admin_redemption_codes_count,
  admin_redemption_codes_title,
  admin_redemption_credit_receipt,
  admin_redemption_credits,
  admin_redemption_create,
  admin_redemption_create_description,
  admin_redemption_create_failed,
  admin_redemption_create_success,
  admin_redemption_create_title,
  admin_redemption_empty,
  admin_redemption_expires_at,
  admin_redemption_load_failed,
  admin_redemption_status,
  admin_redemption_status_active,
  admin_redemption_status_expired,
  admin_redemption_status_redeemed,
  admin_redemption_status_voided,
  admin_redemption_void,
  admin_redemption_void_failed,
  admin_redemption_void_success,
  common_close,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';

interface RedemptionCodeRow {
  id: string;
  code: string;
  status: string;
  revision: number;
  credits?: number;
  grants: Record<string, number>;
  expiresAt: string | null;
  batchId?: string;
  creditGrantTransactionId?: string;
  redeemedWorkspaceId?: string;
}

const STATUS_LABELS: Record<string, () => string> = {
  active: admin_redemption_status_active,
  redeemed: admin_redemption_status_redeemed,
  voided: admin_redemption_status_voided,
  expired: admin_redemption_status_expired,
};

const STATUS_VARIANTS: Record<
  string,
  'success-light' | 'info-light' | 'warning-light' | 'secondary'
> = {
  active: 'success-light',
  redeemed: 'info-light',
  expired: 'warning-light',
  voided: 'secondary',
};

const REDEMPTION_LIST_KEY = ['admin', 'redemptions', 'list'];

export function canRecordRedemptionCode(input: {
  code: string;
  credits: string;
  expiresAt: string;
}) {
  const credits = Number(input.credits);
  const normalizedCode = input.code.trim().toUpperCase();
  return (
    Number.isSafeInteger(credits) &&
    credits > 0 &&
    /^[A-Z0-9_-]{4,64}$/.test(normalizedCode) &&
    (!input.expiresAt || Number.isFinite(Date.parse(input.expiresAt)))
  );
}

/**
 * Recording sheet. The draft and the intent key live here rather than in the
 * popup, which unmounts on close: a create that lost its response can then be
 * replayed under the same idempotency key once the sheet is reopened.
 */
export function RedemptionCreateSheet({
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const queryClient = useQueryClient();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [credits, setCredits] = useState('30');
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const createIntentRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);

  const refreshRedemptionList = () =>
    queryClient.invalidateQueries({ queryKey: REDEMPTION_LIST_KEY });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: code.trim(),
        credits: Number(credits),
        grants: {},
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (createIntentRef.current?.fingerprint !== fingerprint) {
        createIntentRef.current = {
          fingerprint,
          idempotencyKey: `redeem-create-${crypto.randomUUID()}`,
        };
      }
      return commandP1(
        'redemptions',
        {
          action: 'create',
          payload,
        },
        createIntentRef.current.idempotencyKey
      );
    },
    onSuccess: () => {
      createIntentRef.current = null;
      toast.success(admin_redemption_create_success());
      setCode('');
      setOpen(false);
      void refreshRedemptionList();
    },
    onError: () => {
      toast.error(admin_redemption_create_failed());
      void refreshRedemptionList();
    },
  });

  const canCreate = canRecordRedemptionCode({ code, credits, expiresAt });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          trigger ?? (
            <Button data-testid="admin-redemption-create-trigger">
              <IconPlus />
              {admin_redemption_create_title()}
            </Button>
          )
        }
      />
      <SheetContent
        side="right"
        className="z-50 flex flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0 outline-none data-[side=right]:inset-y-4 data-[side=right]:right-4 data-[side=right]:left-auto data-[side=right]:h-[calc(100svh-2rem)] data-[side=right]:w-[min(30rem,calc(100vw-2rem))] data-[side=right]:max-w-none data-[side=right]:sm:max-w-none"
      >
        <SheetHeader className="border-b px-5 py-4 sm:px-6">
          <SheetTitle>{admin_redemption_create_title()}</SheetTitle>
          <SheetDescription>
            {admin_redemption_create_description()}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="redeem-credits">
              {admin_redemption_credits()}
            </FieldLabel>
            <Input
              id="redeem-credits"
              inputMode="numeric"
              min={1}
              step={1}
              type="number"
              value={credits}
              onChange={(event) => setCredits(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="redeem-code">
              {admin_redemption_code()}
            </FieldLabel>
            <Input
              id="redeem-code"
              maxLength={64}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={admin_redemption_code_placeholder()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="redeem-expires">
              {admin_redemption_expires_at()}
            </FieldLabel>
            <Input
              id="redeem-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
        </div>

        <SheetFooter className="flex-row justify-end border-t px-5 py-4 sm:px-6">
          <SheetClose render={<Button type="button" variant="outline" />}>
            {common_close()}
          </SheetClose>
          <Button
            type="button"
            disabled={createMutation.isPending || !canCreate}
            onClick={() => createMutation.mutate()}
          >
            {admin_redemption_create()}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function AdminRedemptionControl() {
  const listQuery = useQuery({
    queryKey: REDEMPTION_LIST_KEY,
    queryFn: () =>
      queryP1('redemptions', {
        action: 'list',
        payload: {},
      }),
  });
  const queryClient = useQueryClient();

  const voidMutation = useMutation({
    mutationFn: async (row: RedemptionCodeRow) =>
      commandP1(
        'redemptions',
        {
          action: 'void',
          payload: {
            code: row.code,
            expectedRevision: row.revision,
          },
        },
        `redeem-void-${row.id}-${row.revision}`
      ),
    onSuccess: () => {
      toast.success(admin_redemption_void_success());
      void queryClient.invalidateQueries({ queryKey: REDEMPTION_LIST_KEY });
    },
    onError: () => {
      toast.error(admin_redemption_void_failed());
    },
  });

  const rows = (listQuery.data ?? []) as unknown as RedemptionCodeRow[];

  return (
    <Frame dense className="w-full">
      <FrameHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <FrameTitle>{admin_redemption_codes_title()}</FrameTitle>
          <FrameDescription>
            {listQuery.isError
              ? admin_redemption_load_failed()
              : admin_redemption_codes_count({ count: rows.length })}
          </FrameDescription>
        </div>
        <RedemptionCreateSheet />
      </FrameHeader>
      <FramePanel className="p-0! shadow-none!">
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{admin_redemption_code()}</TableHead>
                <TableHead>{admin_redemption_status()}</TableHead>
                <TableHead>{admin_redemption_credits()}</TableHead>
                <TableHead>{admin_redemption_expires_at()}</TableHead>
                <TableHead>{admin_redemption_credit_receipt()}</TableHead>
                <TableHead>{admin_redemption_actions()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono">{row.code}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[row.status] ?? 'secondary'}>
                      {STATUS_LABELS[row.status]?.() ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {row.credits !== undefined
                      ? `${row.credits} ${admin_redemption_credits()}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {row.expiresAt
                      ? new Date(row.expiresAt).toLocaleString()
                      : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.creditGrantTransactionId ?? '—'}
                  </TableCell>
                  <TableCell>
                    {row.status === 'active' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={voidMutation.isPending}
                        onClick={() => voidMutation.mutate(row)}
                      >
                        {admin_redemption_void()}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !listQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    className="h-24 text-center text-muted-foreground"
                    colSpan={6}
                  >
                    {admin_redemption_empty()}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </FramePanel>
    </Frame>
  );
}
