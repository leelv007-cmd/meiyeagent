import { IconFlask2 } from '@tabler/icons-react';
import Container from '@/components/layout/container';
import { CameraCaptureProof } from './camera-capture-proof';
import { MediaHandoffProof } from './media-handoff-proof';
import { PwaInstallProof } from './pwa-install-proof';

export function PwaProof() {
  return (
    <div className="bg-background">
      <header className="border-b bg-muted/30">
        <Container className="px-4 py-10 sm:py-14">
          <div className="mx-auto max-w-5xl">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <IconFlask2 className="size-4" aria-hidden="true" />
              Mobile primitive proof
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-bold sm:text-4xl">
              移动端能力验证
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
              在业务素材与发布包流程接入前，先验证 Web 安装、后置相机和 iOS
              文件交接的真实浏览器边界。
            </p>
          </div>
        </Container>
      </header>

      <Container className="px-4 pb-12">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-x-10 lg:grid-cols-2">
            <PwaInstallProof />
            <CameraCaptureProof />
          </div>
          <MediaHandoffProof />
        </div>
      </Container>
    </div>
  );
}
