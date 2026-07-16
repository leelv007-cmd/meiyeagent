import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDeviceMobile,
  IconRefresh,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type WorkerState = 'checking' | 'error' | 'ready' | 'unsupported';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const WORKER_COPY: Record<WorkerState, { detail: string; title: string }> = {
  checking: {
    title: '正在检查 Service Worker',
    detail: '页面正在确认离线壳可以由浏览器接管。',
  },
  ready: {
    title: 'Service Worker 已就绪',
    detail: '根作用域已注册；是否显示安装入口仍由当前浏览器决定。',
  },
  unsupported: {
    title: '当前浏览器不支持 Web 安装',
    detail: '请改用最新版 Safari 或 Chrome；相机和下载流程仍可继续验证。',
  },
  error: {
    title: 'Service Worker 注册失败',
    detail:
      '请确认页面使用 HTTPS 或 localhost，刷新后重试；不要在应用内置浏览器中安装。',
  },
};

export function PwaInstallProof() {
  const [workerState, setWorkerState] = useState<WorkerState>('checking');
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null
  );
  const [installResult, setInstallResult] = useState<string | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  const registerWorker = useCallback(async () => {
    setWorkerState('checking');
    if (!('serviceWorker' in navigator)) {
      setWorkerState('unsupported');
      return;
    }
    if (!window.isSecureContext) {
      setWorkerState('error');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      await navigator.serviceWorker.ready;
      registration.waiting?.postMessage('SKIP_WAITING');
      setWorkerState('ready');
    } catch {
      setWorkerState('error');
    }
  }, []);

  useEffect(() => {
    const standaloneNavigator = navigator as Navigator & {
      standalone?: boolean;
    };
    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
        standaloneNavigator.standalone === true
    );
    void registerWorker();

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
    };
  }, [registerWorker]);

  const requestInstall = async () => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallResult(
      outcome === 'accepted'
        ? '安装请求已交给系统。'
        : '你取消了安装，可从浏览器菜单再次尝试。'
    );
  };

  const workerCopy = WORKER_COPY[workerState];
  const WorkerIcon =
    workerState === 'ready' ? IconCircleCheck : IconAlertTriangle;

  return (
    <section aria-labelledby="pwa-install-title" className="border-t py-8">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconDeviceMobile className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary uppercase">
            01 / Install
          </p>
          <h2 id="pwa-install-title" className="mt-1 text-xl font-semibold">
            Web 安装与离线壳
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            检查生产同形的 worker 注册和浏览器安装入口。
          </p>
        </div>
      </div>

      <output
        className="mt-5 flex items-start gap-3 rounded-lg border bg-muted/40 p-4"
        data-testid="service-worker-status"
        aria-live="polite"
      >
        <WorkerIcon
          className={
            workerState === 'ready'
              ? 'mt-0.5 size-5 shrink-0 text-emerald-600'
              : 'mt-0.5 size-5 shrink-0 text-amber-600'
          }
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="font-medium">{workerCopy.title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {workerCopy.detail}
          </p>
        </div>
      </output>

      <div className="mt-4 space-y-3">
        {isStandalone ? (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            当前已在独立应用模式中运行。
          </p>
        ) : installPrompt ? (
          <Button className="h-11 w-full sm:w-auto" onClick={requestInstall}>
            <IconDeviceMobile aria-hidden="true" />
            安装到设备
          </Button>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            {isIos
              ? '在 Safari 点击“分享”，然后选择“添加到主屏幕”。'
              : '如未出现安装按钮，请打开浏览器菜单并选择“安装应用”。'}
          </p>
        )}

        {installResult ? (
          <p className="text-sm text-muted-foreground">{installResult}</p>
        ) : null}

        {workerState === 'error' ? (
          <Button
            className="h-11"
            variant="outline"
            onClick={() => void registerWorker()}
          >
            <IconRefresh aria-hidden="true" />
            重新检测
          </Button>
        ) : null}
      </div>
    </section>
  );
}
