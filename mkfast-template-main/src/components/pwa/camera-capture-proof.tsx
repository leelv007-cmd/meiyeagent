import { IconCamera, IconCircleCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const CAMERA_FAILURE_GUIDANCE =
  '浏览器没有允许打开相机。请在 Safari > 网站设置 > 相机中选择“允许”后重试；也可从照片图库选择素材。';

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  return `${(size / 1024).toFixed(1)} KB`;
}

export function CameraCaptureProof() {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState(
    '点击后由系统打开后置相机；若设备不支持，会回退到照片图库。'
  );
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const input = inputRef.current;
    const handleCancel = () => {
      setHasError(true);
      setStatus('系统未返回照片。请重试并确认相机权限，或从照片图库选择素材。');
    };
    input?.addEventListener('cancel', handleCancel);

    return () => {
      input?.removeEventListener('cancel', handleCancel);
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const openCamera = () => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    setHasError(false);
    setStatus('正在请求系统相机…');
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
      } else {
        input.click();
      }
    } catch {
      setHasError(true);
      setStatus(CAMERA_FAILURE_GUIDANCE);
    }
  };

  const handleCapture = (nextFile?: File) => {
    if (!nextFile) {
      setHasError(true);
      setStatus('系统未返回照片。请重试并确认相机权限，或从照片图库选择素材。');
      return;
    }
    if (!nextFile.type.startsWith('image/')) {
      setHasError(true);
      setStatus('只能接收图片。请重新拍摄，或从照片图库选择图片。');
      return;
    }

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const nextPreviewUrl = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextPreviewUrl;
    setPreviewUrl(nextPreviewUrl);
    setFile(nextFile);
    setHasError(false);
    setStatus('已收到相机素材，可继续上传或授权流程。');
  };

  return (
    <section aria-labelledby="camera-capture-title" className="border-t py-8">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <IconCamera className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-emerald-700 uppercase dark:text-emerald-400">
            02 / Capture
          </p>
          <h2 id="camera-capture-title" className="mt-1 text-xl font-semibold">
            后置相机回传
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            直接调起设备拍摄，并把返回文件显示在当前页面。
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        className="sr-only"
        data-testid="camera-input"
        aria-label="相机图片输入"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => handleCapture(event.currentTarget.files?.[0])}
      />

      <Button className="mt-5 h-11 w-full sm:w-auto" onClick={openCamera}>
        <IconCamera aria-hidden="true" />
        打开后置相机
      </Button>

      <output
        className={
          hasError
            ? 'mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm leading-6 text-destructive'
            : 'mt-4 rounded-lg border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground'
        }
        data-testid="camera-status"
        aria-live="polite"
      >
        {status}
      </output>

      {previewUrl && file ? (
        <div className="mt-5 overflow-hidden rounded-lg border bg-muted/30">
          <div className="h-64 bg-zinc-950 sm:h-72">
            <img
              className="size-full object-contain"
              src={previewUrl}
              alt="相机回传预览"
            />
          </div>
          <div className="flex min-w-0 items-center gap-2 border-t px-4 py-3">
            <IconCircleCheck
              className="size-4 shrink-0 text-emerald-600"
              aria-hidden="true"
            />
            <p className="min-w-0 truncate text-sm font-medium">{file.name}</p>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatFileSize(file.size)}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
