/**
 * Ops CRUD for platform sensitive_words lexicon (P2-08 / #320).
 * Bulk-import UI is deferred (see issue-320 handover); single-row CRUD only.
 */
import {
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';
import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  admin_sensitive_words_add_2cd9e6ce,
  admin_sensitive_words_add_entry_9b56203f,
  admin_sensitive_words_cancel_edit_c698df94,
  admin_sensitive_words_category_435c5259,
  admin_sensitive_words_create_failed_deb39901,
  admin_sensitive_words_delete_3755f56f,
  admin_sensitive_words_delete_change_shared_lexicon,
  admin_sensitive_words_delete_change_word,
  admin_sensitive_words_delete_confirm,
  admin_sensitive_words_delete_description,
  admin_sensitive_words_delete_failed_72250c59,
  admin_sensitive_words_delete_scope,
  admin_sensitive_words_delete_title,
  admin_sensitive_words_disable_d989e551,
  admin_sensitive_words_e_g_radical_cure_9f727fe0,
  admin_sensitive_words_edit_a7f814c0,
  admin_sensitive_words_edit_entry_0d55bad7,
  admin_sensitive_words_enable_d4e9ca3d,
  admin_sensitive_words_filter_words_1e810803,
  admin_sensitive_words_load_failed_confirm_ops_permission_and_c_427065e3,
  admin_sensitive_words_loading_ce56f617,
  admin_sensitive_words_no_entries_yet_empty_db_seeds_beauty_bas_bf67178a,
  admin_sensitive_words_noticeable_improvement_improves_with_ong_1a47c483,
  admin_sensitive_words_refresh_38108eaa,
  admin_sensitive_words_replacement_suggestions_comma_separated_ff846274,
  admin_sensitive_words_replacements_803fd078,
  admin_sensitive_words_save_changes_60b4ae90,
  admin_sensitive_words_sensitive_word_created_fc1e483e,
  admin_sensitive_words_sensitive_word_deleted_dc0c853f,
  admin_sensitive_words_sensitive_word_updated_6b0d396a,
  admin_sensitive_words_status_updated_fd9803a8,
  admin_sensitive_words_total_count,
  admin_sensitive_words_update_failed_8f8818f0,
  admin_sensitive_words_word_2357050e,
  admin_supply_action_f3ea6d34,
  admin_supply_status_62e951a6,
} from '@/locale/paraglide/messages';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import type { SensitiveWordRecord } from '@meiye/contracts';

import {
  ADMIN_SENSITIVE_WORD_CATEGORIES,
  categoryLabel,
  draftFromRecord,
  emptySensitiveWordDraft,
  parseReplacementsText,
  validateSensitiveWordDraft,
  type AdminSensitiveWordDraft,
} from './admin-sensitive-words-model';

type ListPayload = {
  items: SensitiveWordRecord[];
  total: number;
};

export function AdminSensitiveWordsControl() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AdminSensitiveWordDraft>(
    emptySensitiveWordDraft()
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [impactReview, setImpactReview] = useState<ImpactReviewRequest>();

  const listQuery = useQuery({
    queryKey: p1QueryKeys.request('sensitive-words', 'list', { q: filter }),
    queryFn: () =>
      queryP1<ListPayload>('sensitive-words', {
        action: 'list',
        payload: filter.trim() ? { q: filter.trim() } : {},
      }),
  });

  const items = listQuery.data?.items ?? [];
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word)
      ),
    [items]
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: p1QueryKeys.request('sensitive-words', 'list'),
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const error = validateSensitiveWordDraft(draft);
      if (error) throw new Error(error);
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        word: draft.word.trim(),
        category: draft.category,
        replacements: parseReplacementsText(draft.replacementsText),
        status: draft.status,
      };
      await commandP1('sensitive-words', {
        action: editingId ? 'update' : 'create',
        payload,
      });
      return editingId ? ('updated' as const) : ('created' as const);
    },
    onSuccess: async (result) => {
      toast.success(
        result === 'updated'
          ? admin_sensitive_words_sensitive_word_updated_6b0d396a()
          : admin_sensitive_words_sensitive_word_created_fc1e483e()
      );
      setEditingId(null);
      setDraft(emptySensitiveWordDraft());
      await invalidate();
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          (editingId
            ? admin_sensitive_words_update_failed_8f8818f0()
            : admin_sensitive_words_create_failed_deb39901())
      );
    },
  });

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(emptySensitiveWordDraft());
  };

  const startEditing = (row: SensitiveWordRecord) => {
    setEditingId(row.id);
    setDraft(draftFromRecord(row));
  };

  const toggleMutation = useMutation({
    mutationFn: async (row: SensitiveWordRecord) =>
      commandP1('sensitive-words', {
        action: 'update',
        payload: {
          id: row.id,
          status: row.status === 'enabled' ? 'disabled' : 'enabled',
        },
      }),
    onSuccess: async () => {
      toast.success(admin_sensitive_words_status_updated_fd9803a8());
      await invalidate();
    },
    onError: (error: Error) => {
      toast.error(
        error.message || admin_sensitive_words_update_failed_8f8818f0()
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      commandP1('sensitive-words', {
        action: 'delete',
        payload: { id },
      }),
    onSuccess: async () => {
      toast.success(admin_sensitive_words_sensitive_word_deleted_dc0c853f());
      await invalidate();
    },
    onError: (error: Error) => {
      toast.error(
        error.message || admin_sensitive_words_delete_failed_72250c59()
      );
    },
  });

  const reviewDelete = (row: SensitiveWordRecord) => {
    setImpactReview({
      title: admin_sensitive_words_delete_title(),
      description: admin_sensitive_words_delete_description(),
      scope: admin_sensitive_words_delete_scope({ word: row.word }),
      changes: [
        admin_sensitive_words_delete_change_word({ word: row.word }),
        admin_sensitive_words_delete_change_shared_lexicon(),
      ],
      confirmLabel: admin_sensitive_words_delete_confirm(),
      onConfirm: async () => {
        await deleteMutation.mutateAsync(row.id);
      },
    });
  };

  return (
    <Frame data-testid="admin-sensitive-words">
      <FrameHeader className="flex-row items-start justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void listQuery.refetch()}
          data-testid="admin-sensitive-words-refresh"
        >
          <IconRefresh className="size-4" />
          {admin_sensitive_words_refresh_38108eaa()}
        </Button>
      </FrameHeader>
      <FramePanel className="space-y-4">
        <Frame dense headingLevel={3}>
          <FrameHeader>
            <FrameTitle>
              {editingId
                ? admin_sensitive_words_edit_entry_0d55bad7()
                : admin_sensitive_words_add_entry_9b56203f()}
            </FrameTitle>
          </FrameHeader>
          <FramePanel>
            <form
              className="grid gap-3 md:grid-cols-2"
              data-testid="admin-sensitive-words-create"
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate();
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="sw-word">
                  {admin_sensitive_words_word_2357050e()}
                </Label>
                <Input
                  id="sw-word"
                  value={draft.word}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      word: event.target.value,
                    }))
                  }
                  placeholder={admin_sensitive_words_e_g_radical_cure_9f727fe0()}
                  data-testid="admin-sensitive-words-word"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sw-category">
                  {admin_sensitive_words_category_435c5259()}
                </Label>
                <Select
                  onValueChange={(value) => {
                    if (!value) return;
                    setDraft((current) => ({
                      ...current,
                      category: value as AdminSensitiveWordDraft['category'],
                    }));
                  }}
                  value={draft.category}
                >
                  <SelectTrigger
                    className="w-full"
                    data-testid="admin-sensitive-words-category"
                    id="sw-category"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADMIN_SENSITIVE_WORD_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {categoryLabel(category)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="sw-replacements">
                  {admin_sensitive_words_replacement_suggestions_comma_separated_ff846274()}
                </Label>
                <Input
                  id="sw-replacements"
                  value={draft.replacementsText}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      replacementsText: event.target.value,
                    }))
                  }
                  placeholder={admin_sensitive_words_noticeable_improvement_improves_with_ong_1a47c483()}
                  data-testid="admin-sensitive-words-replacements"
                />
              </div>
              <div className="flex items-end gap-2 md:col-span-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={saveMutation.isPending}
                  data-testid="admin-sensitive-words-create-submit"
                >
                  {editingId ? (
                    <IconEdit className="size-4" />
                  ) : (
                    <IconPlus className="size-4" />
                  )}
                  {editingId
                    ? admin_sensitive_words_save_changes_60b4ae90()
                    : admin_sensitive_words_add_2cd9e6ce()}
                </Button>
                {editingId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={cancelEditing}
                  >
                    {admin_sensitive_words_cancel_edit_c698df94()}
                  </Button>
                ) : null}
              </div>
            </form>
          </FramePanel>
        </Frame>

        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={admin_sensitive_words_filter_words_1e810803()}
            className="max-w-xs"
            data-testid="admin-sensitive-words-filter"
          />
          <Badge variant="secondary">
            {listQuery.isLoading
              ? admin_sensitive_words_loading_ce56f617()
              : admin_sensitive_words_total_count({ count: sorted.length })}
          </Badge>
        </div>

        <Table data-testid="admin-sensitive-words-table">
          <TableHeader>
            <TableRow>
              <TableHead>{admin_sensitive_words_word_2357050e()}</TableHead>
              <TableHead>{admin_sensitive_words_category_435c5259()}</TableHead>
              <TableHead>
                {admin_sensitive_words_replacements_803fd078()}
              </TableHead>
              <TableHead>{admin_supply_status_62e951a6()}</TableHead>
              <TableHead className="w-[140px]">
                {admin_supply_action_f3ea6d34()}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {listQuery.isError
                    ? admin_sensitive_words_load_failed_confirm_ops_permission_and_c_427065e3()
                    : admin_sensitive_words_no_entries_yet_empty_db_seeds_beauty_bas_bf67178a()}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid={`admin-sensitive-words-row-${row.id}`}
                >
                  <TableCell className="font-medium">{row.word}</TableCell>
                  <TableCell>{categoryLabel(row.category)}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-sm">
                    {row.replacements.join('，') || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === 'enabled' ? 'success-light' : 'secondary'
                      }
                    >
                      {row.status === 'enabled'
                        ? admin_sensitive_words_enable_d4e9ca3d()
                        : admin_sensitive_words_disable_d989e551()}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => startEditing(row)}
                      data-testid={`admin-sensitive-words-edit-${row.id}`}
                    >
                      <IconEdit className="size-4" aria-hidden="true" />
                      {admin_sensitive_words_edit_a7f814c0()}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => toggleMutation.mutate(row)}
                      data-testid={`admin-sensitive-words-toggle-${row.id}`}
                    >
                      {row.status === 'enabled'
                        ? admin_sensitive_words_disable_d989e551()
                        : admin_sensitive_words_enable_d4e9ca3d()}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={admin_sensitive_words_delete_3755f56f()}
                      onClick={() => reviewDelete(row)}
                      data-testid={`admin-sensitive-words-delete-${row.id}`}
                    >
                      <IconTrash className="size-4" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </FramePanel>
      <ImpactReviewDialog
        onOpenChange={(open) => !open && setImpactReview(undefined)}
        open={Boolean(impactReview)}
        request={impactReview}
      />
    </Frame>
  );
}
