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
  AdminPanel,
  AdminPanelContent,
  AdminPanelDescription,
  AdminPanelHeader,
  AdminPanelTitle,
  AdminStatusChip,
} from '@/components/admin/shell/admin-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      toast.success(result === 'updated' ? '违禁词已更新' : '违禁词已创建');
      setEditingId(null);
      setDraft(emptySensitiveWordDraft());
      await invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || (editingId ? '更新失败' : '创建失败'));
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
      toast.success('状态已更新');
      await invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || '更新失败');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      commandP1('sensitive-words', {
        action: 'delete',
        payload: { id },
      }),
    onSuccess: async () => {
      toast.success('违禁词已删除');
      await invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || '删除失败');
    },
  });

  return (
    <AdminPanel data-testid="admin-sensitive-words">
      <AdminPanelHeader>
        <div className="space-y-1">
          <AdminPanelTitle>违禁词库</AdminPanelTitle>
          <AdminPanelDescription>
            美业专项词库（word / category / replacements /
            status）。生成链检查与红线门共库；批量导入 UI 本票不做，仅单条
            CRUD。
          </AdminPanelDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void listQuery.refetch()}
          data-testid="admin-sensitive-words-refresh"
        >
          <IconRefresh className="size-4" />
          刷新
        </Button>
      </AdminPanelHeader>
      <AdminPanelContent className="space-y-4">
        <form
          className="grid gap-3 rounded-md border p-3 md:grid-cols-2"
          data-testid="admin-sensitive-words-create"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <p className="text-sm font-medium md:col-span-2">
            {editingId ? '编辑词条' : '新增词条'}
          </p>
          <div className="space-y-1">
            <Label htmlFor="sw-word">词条</Label>
            <Input
              id="sw-word"
              value={draft.word}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  word: event.target.value,
                }))
              }
              placeholder="例如：根治"
              data-testid="admin-sensitive-words-word"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sw-category">分类</Label>
            <select
              id="sw-category"
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={draft.category}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  category: event.target
                    .value as AdminSensitiveWordDraft['category'],
                }))
              }
              data-testid="admin-sensitive-words-category"
            >
              {ADMIN_SENSITIVE_WORD_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="sw-replacements">替换建议（逗号分隔）</Label>
            <Input
              id="sw-replacements"
              value={draft.replacementsText}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  replacementsText: event.target.value,
                }))
              }
              placeholder="明显改善，持续护理后改善"
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
              {editingId ? '保存修改' : '新增'}
            </Button>
            {editingId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelEditing}
              >
                取消编辑
              </Button>
            ) : null}
          </div>
        </form>

        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="筛选词条"
            className="max-w-xs"
            data-testid="admin-sensitive-words-filter"
          />
          <AdminStatusChip>
            {listQuery.isLoading ? '加载中' : `共 ${sorted.length} 条`}
          </AdminStatusChip>
        </div>

        <Table data-testid="admin-sensitive-words-table">
          <TableHeader>
            <TableRow>
              <TableHead>词条</TableHead>
              <TableHead>分类</TableHead>
              <TableHead>替换建议</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-[140px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {listQuery.isError
                    ? '加载失败，请确认运营权限与 Core 已启动。'
                    : '暂无词条（空库会在 Core 启动时 seed 美业基线）。'}
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
                    <AdminStatusChip>
                      {row.status === 'enabled' ? '启用' : '停用'}
                    </AdminStatusChip>
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
                      编辑
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => toggleMutation.mutate(row)}
                      data-testid={`admin-sensitive-words-toggle-${row.id}`}
                    >
                      {row.status === 'enabled' ? '停用' : '启用'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="删除"
                      onClick={() => {
                        if (
                          typeof window !== 'undefined' &&
                          !window.confirm(`删除「${row.word}」？`)
                        ) {
                          return;
                        }
                        deleteMutation.mutate(row.id);
                      }}
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
      </AdminPanelContent>
    </AdminPanel>
  );
}
