import {
  listPaymentRefundReviews,
  resolvePaymentRefund,
} from '@/api/payment-refunds';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatLocaleDateTime } from '@/lib/locale';
import type { PaymentRefundReviewItem } from '@/payment/payment-refunds';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

/** Shared with header ops-todo popover — same query, never a second source. */
export const PAYMENT_REFUND_REVIEW_QUERY_KEY = [
  'admin',
  'payment-refund-reviews',
] as const;

export function AdminPaymentRefundReview() {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const reviews = useQuery({
    queryKey: PAYMENT_REFUND_REVIEW_QUERY_KEY,
    queryFn: () => listPaymentRefundReviews({ data: { limit: 100 } }),
  });
  const resolveReview = useMutation({
    mutationFn: (item: PaymentRefundReviewItem) =>
      resolvePaymentRefund({
        data: {
          eventStatus: item.eventStatus,
          note: notes[item.providerEventId]?.trim() ?? '',
          providerEventId: item.providerEventId,
        },
      }),
    onSuccess: async (_result, item) => {
      setNotes((current) => {
        const next = { ...current };
        delete next[item.providerEventId];
        return next;
      });
      await queryClient.invalidateQueries({
        queryKey: PAYMENT_REFUND_REVIEW_QUERY_KEY,
      });
      toast.success('Refund review resolved.');
    },
    onError: () => toast.error('Refund review could not be resolved.'),
  });
  const rows = reviews.data ?? [];

  return (
    <Frame data-testid="admin-payment-refund-review" dense>
      <FrameHeader>
        <FrameTitle>Payment refund review</FrameTitle>
        <FrameDescription>
          Review provider refund facts without changing customer credits.
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="overflow-x-auto">
        {reviews.isPending ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : reviews.isError ? (
          <p className="text-sm text-destructive">
            Refund reviews could not be loaded.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Refund</TableHead>
                <TableHead>Provider facts</TableHead>
                <TableHead>Audit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={4}>
                    No refund reviews.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((item) => (
                  <RefundReviewRow
                    item={item}
                    key={item.providerEventId}
                    note={notes[item.providerEventId] ?? ''}
                    onNoteChange={(note) =>
                      setNotes((current) => ({
                        ...current,
                        [item.providerEventId]: note,
                      }))
                    }
                    onResolve={() => resolveReview.mutate(item)}
                    resolving={
                      resolveReview.isPending &&
                      resolveReview.variables?.providerEventId ===
                        item.providerEventId
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        )}
      </FramePanel>
    </Frame>
  );
}

function RefundReviewRow({
  item,
  note,
  onNoteChange,
  onResolve,
  resolving,
}: {
  item: PaymentRefundReviewItem;
  note: string;
  onNoteChange: (note: string) => void;
  onResolve: () => void;
  resolving: boolean;
}) {
  const noteId = `refund-review-note-${item.providerEventId}`;

  return (
    <TableRow data-testid={`refund-review-${item.providerEventId}`}>
      <TableCell>
        <Badge
          variant={
            item.dispositionStatus === 'resolved' ? 'success-light' : 'outline'
          }
        >
          {item.dispositionStatus}
        </Badge>
        <p className="mt-1 text-xs text-muted-foreground">{item.eventStatus}</p>
      </TableCell>
      <TableCell>
        <p className="font-medium">
          {item.currency} {item.amount}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {item.orderId}
        </p>
      </TableCell>
      <TableCell className="max-w-80 text-xs">
        <p className="break-all font-mono">{item.providerEventId}</p>
        <p className="text-muted-foreground">
          {formatLocaleDateTime(item.providerOccurredAt)}
        </p>
      </TableCell>
      <TableCell className="min-w-72">
        {item.dispositionStatus === 'resolved' ? (
          <div className="text-xs">
            <p>{item.dispositionNote}</p>
            <p className="mt-1 font-mono text-muted-foreground">
              {item.dispositionActorUserId}
            </p>
            <p className="text-muted-foreground">
              {item.resolvedAt
                ? formatLocaleDateTime(item.resolvedAt)
                : 'Unknown resolution time'}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor={noteId}>Resolution note</Label>
            <Textarea
              id={noteId}
              maxLength={2_000}
              onChange={(event) => onNoteChange(event.target.value)}
              value={note}
            />
            <Button
              disabled={resolving || note.trim().length === 0}
              onClick={onResolve}
              type="button"
            >
              Resolve review
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
