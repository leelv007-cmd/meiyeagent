import type { ReactNode } from 'react';

// 后台设置类行首的图标容器：一块托着字形的 muted 底板，靠与背景同色的描边
// 从表面上抬起来。尺寸由容器统一持有，调用方传裸图标、不带 size class。
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <div className="border-background bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg border-2 shadow-[0_1px_3px_0_oklch(0.2_0.01_260/0.16)] dark:border [&_svg]:size-4">
      {children}
    </div>
  );
}
