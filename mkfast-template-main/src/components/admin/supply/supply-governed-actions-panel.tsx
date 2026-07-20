/**
 * Governed quick actions panel (J5 / D-070 ③).
 * Lists the full action set with permission / preview / CAS flags.
 * Execution goes through ImpactReviewDialog + Core typed commands (no secrets).
 */
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { GovernedActionsPanelView } from '@/p1/admin-supply-quick-actions-model';

export function SupplyGovernedActionsPanel({
  view,
}: {
  view: GovernedActionsPanelView;
}) {
  return (
    <section
      data-testid="supply-governed-actions-panel"
      data-action-count={String(view.count)}
      data-forbid-secret-echo={String(view.forbids.secretEcho)}
      data-forbid-direct-db={String(view.forbids.directDbWrite)}
      data-forbid-bypass-publish={String(view.forbids.bypassPublishGate)}
      data-forbid-blind-retry={String(
        view.forbids.blindRetryAcceptedUnknownMedia,
      )}
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold">受治理快捷动作</h2>
        <p className="text-xs text-muted-foreground">
          全部走 Core 类型化命令 + capability permission + 影响预览 + 原因 +
          CAS/幂等 + 可逆排空 + 不可变审计。不暴露密钥、不直写库、不绕发布门、不对
          accepted/unknown 媒体盲目重试。
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">禁止密钥回显</Badge>
        <Badge variant="outline">禁止直写库</Badge>
        <Badge variant="outline">禁止绕发布门</Badge>
        <Badge variant="outline">禁止盲目重试 accepted/unknown</Badge>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>动作</TableHead>
              <TableHead>权限</TableHead>
              <TableHead>预览</TableHead>
              <TableHead>原因</TableHead>
              <TableHead>CAS/幂等</TableHead>
              <TableHead>可逆排空</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.actions.map((action) => (
              <TableRow
                key={action.id}
                data-testid="supply-governed-action-row"
                data-action-id={action.id}
                data-permission={action.permission}
                data-requires-preview={String(action.requiresImpactPreview)}
                data-requires-reason={String(action.requiresReason)}
                data-cas={String(action.casIdempotency)}
                data-reversible-drain={String(action.reversibleDrain)}
              >
                <TableCell>
                  <p className="font-medium">{action.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {action.description}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {action.id}
                  </p>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {action.permission}
                </TableCell>
                <TableCell>
                  {action.requiresImpactPreview ? '是' : '否'}
                </TableCell>
                <TableCell>{action.requiresReason ? '是' : '否'}</TableCell>
                <TableCell>{action.casIdempotency ? '是' : '否'}</TableCell>
                <TableCell>{action.reversibleDrain ? '是' : '否'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
