import {
  IconDownload,
  IconPhoto,
  IconShare3,
  IconVideo,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createMediaFixtures, type MediaFixture } from './media-fixtures';

type PreparedFixture = MediaFixture & { url: string };

function canShareFile(file: File) {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

export function MediaHandoffProof() {
  const [fixtures, setFixtures] = useState<PreparedFixture[]>([]);
  const [status, setStatus] = useState('正在准备图片和视频测试文件…');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];

    void createMediaFixtures()
      .then((createdFixtures) => {
        if (!active) {
          return;
        }
        const prepared = createdFixtures.map((fixture) => {
          const url = URL.createObjectURL(fixture.file);
          objectUrls.push(url);
          return { ...fixture, url };
        });
        setFixtures(prepared);
        setStatus(
          prepared.some((fixture) => canShareFile(fixture.file))
            ? '系统分享可用。如分享面板中没有“存储到照片”，请使用始终可见的下载按钮。'
            : '当前浏览器不支持文件分享。请使用下方下载，再从“文件”App 存入相册。'
        );
      })
      .catch(() => {
        if (active) {
          setHasError(true);
          setStatus(
            '测试文件生成失败。请刷新页面；如仍失败，请更新 Safari 或 Chrome。'
          );
        }
      });

    return () => {
      active = false;
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const shareFixture = async (fixture: PreparedFixture) => {
    if (!canShareFile(fixture.file)) {
      setHasError(true);
      setStatus(
        `当前浏览器无法分享${fixture.label}文件。请使用下载，再从“文件”App 存入相册。`
      );
      return;
    }

    try {
      await navigator.share({
        files: [fixture.file],
        title: `美业内容 ${fixture.label}交接测试`,
      });
      setHasError(false);
      setStatus(
        `${fixture.label}已交给系统分享面板。如未存入相册，请改用下载。`
      );
    } catch (error) {
      setHasError(true);
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('分享未完成。可重试打开系统分享，或使用始终可见的下载按钮。');
        return;
      }
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setStatus(
          '浏览器阻止了分享。请通过页面按钮重试，或使用下载后从“文件”App 存入相册。'
        );
        return;
      }
      setStatus(
        '系统分享失败。请重试；如仍失败，请使用下载后从“文件”App 存入相册。'
      );
    }
  };

  const handleDownload = (fixture: PreparedFixture) => {
    setHasError(false);
    setStatus(
      `${fixture.label}已开始下载。iOS 中可在“文件”App 打开后选择存储图像或视频。`
    );
  };

  return (
    <section aria-labelledby="media-handoff-title" className="border-t py-8">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-400">
          <IconShare3 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-700 uppercase dark:text-sky-400">
            03 / Handoff
          </p>
          <h2 id="media-handoff-title" className="mt-1 text-xl font-semibold">
            图片与视频交接
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            优先使用系统分享，同时保留不依赖权限的下载路径。
          </p>
        </div>
      </div>

      <output
        className={
          hasError
            ? 'mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-destructive'
            : 'mt-5 rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground'
        }
        data-testid="share-status"
        aria-live="polite"
      >
        {status}
      </output>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {fixtures.map((fixture) => {
          const shareAvailable = canShareFile(fixture.file);
          const MediaIcon = fixture.kind === 'image' ? IconPhoto : IconVideo;

          return (
            <article
              className="overflow-hidden rounded-lg border bg-card"
              key={fixture.kind}
            >
              <div className="h-72 bg-zinc-950 sm:h-80">
                {fixture.kind === 'image' ? (
                  <img
                    className="size-full object-cover"
                    src={fixture.url}
                    alt="生成的图片测试文件"
                  />
                ) : (
                  <video
                    className="size-full object-contain"
                    src={fixture.url}
                    aria-label="生成的视频测试文件"
                    controls
                    muted
                    playsInline
                    preload="metadata"
                  />
                )}
              </div>
              <div className="space-y-4 border-t p-4">
                <div className="flex items-center gap-2">
                  <MediaIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{fixture.label}测试文件</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {fixture.file.name}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {shareAvailable ? (
                    <Button
                      className="h-11 flex-1"
                      onClick={() => void shareFixture(fixture)}
                    >
                      <IconShare3 aria-hidden="true" />
                      分享{fixture.label}
                    </Button>
                  ) : null}
                  <a
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'lg' }),
                      'h-11 flex-1'
                    )}
                    href={fixture.url}
                    download={fixture.file.name}
                    onClick={() => handleDownload(fixture)}
                  >
                    <IconDownload aria-hidden="true" />
                    下载{fixture.label}
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
