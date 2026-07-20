import { CapabilityDrilldownBanner } from '@/components/admin/capability/capability-drilldown-banner';
import { AdminRoutePage } from '@/components/admin/admin-route-page';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createFileRoute } from '@tanstack/react-router';

/**
 * Redemptions drilldown under 账号与商业化 (J3 seven-page regroup).
 * Control surface body is intentionally lean here — full Td redemption
 * management wires via Z2 when locales/API are assembled. Path is stable
 * for catalog IA reachability.
 *
 * Shared wiring (Routes.AdminRedemptions / sidebar / locales / routeTree)
 * is NOT modified — see capability/WIRING-DIFF.md.
 */
// Path not yet registered in routeTree.gen.ts (Z2-WIRING batch B).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)('/admin/redemptions')({
  component: RedemptionsPage,
});

export function RedemptionsPage() {
  return (
    <AdminRoutePage
      title="兑换码"
      description="生成、查看和作废工作区条数额度兑换码。"
    >
      <div className="space-y-4">
        <CapabilityDrilldownBanner pageId="redemptions" />
        <Card data-testid="redemptions-drilldown-stub">
          <CardHeader>
            <CardTitle className="text-base">兑换码证据下钻</CardTitle>
            <CardDescription>
              功能：兑换码发放、核销与对账入口。用户影响：兑换活动到账与额度补发。
              日常运营路径不提供 code / SQL / env / 原始 JSON / CLI 编辑控件。
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            完整生成/作废控制面由 Td 兑换码模块经 Z2-WIRING 合入；本页先完成能力域编组与运营语言下钻。
          </CardContent>
        </Card>
      </div>
    </AdminRoutePage>
  );
}
