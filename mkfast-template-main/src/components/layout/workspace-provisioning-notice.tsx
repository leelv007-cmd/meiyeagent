import { shell_workspace_provisioning_degraded } from '@/locale/paraglide/messages';

export function WorkspaceProvisioningNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <output
      className="block border-b px-4 py-2 text-sm text-amber-800 dark:text-amber-200 lg:px-6"
      data-testid="workspace-provisioning-notice"
    >
      {shell_workspace_provisioning_degraded()}
    </output>
  );
}
