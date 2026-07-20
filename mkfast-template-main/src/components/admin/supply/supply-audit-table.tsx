import type { SupplyAuditChange } from '@/p1/admin-supply-types';

export function SupplyAuditTable({
  changes,
}: {
  changes: SupplyAuditChange[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left">
          <tr>
            <th className="p-3 font-medium">动作与原因</th>
            <th className="p-3 font-medium">目标</th>
            <th className="p-3 font-medium">操作者与关联</th>
            <th className="p-3 font-medium">时间</th>
          </tr>
        </thead>
        <tbody>
          {changes.length === 0 ? (
            <tr>
              <td className="p-3 text-muted-foreground" colSpan={4}>
                暂无供应治理审计记录
              </td>
            </tr>
          ) : (
            changes.map((change) => (
              <tr className="border-b last:border-b-0" key={change.id}>
                <td className="p-3">
                  <p className="font-mono text-xs">{change.action}</p>
                  <p>{change.summary}</p>
                </td>
                <td className="p-3 font-mono text-xs">
                  {change.targetType}/{change.targetId}
                </td>
                <td className="p-3 font-mono text-xs">
                  <p>{change.actorId}</p>
                  <p className="text-muted-foreground">
                    {change.correlationId}
                  </p>
                </td>
                <td className="p-3 text-xs">{change.at}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
