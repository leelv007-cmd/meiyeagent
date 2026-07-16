export const IMAGE_FIXTURE_NAME = 'meiye-pwa-proof-image.png';
export const VIDEO_FIXTURE_NAME = 'meiye-pwa-proof-video.mp4';

const VIDEO_FIXTURE_BASE64 =
  'AAAAJGZ0eXBpc29tAAACAGlzb21pc282aXNvMmF2YzFtcDQxAAACzG1vb3YAAAB4bXZoZAEAAAAAAAAA5nWirAAAAADmdaKsAAAD6AAAAAAAAAAhAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIkdHJhawAAAGh0a2hkAQAAAwAAAADmdaKsAAAAAOZ1oqwAAAABAAAAAAAAAAAAAAAhAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAC0AAABQAAAAAABtG1kaWEAAAAsbWRoZAEAAAAAAAAA5nWirAAAAADmdaKsAAB1MAAAAAAAAAAhVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAVNtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAlZGluZgAAAB1kcmVmAAAAAAAAAAEAAAANdXJsIAAAAAEAAAABEnN0YmwAAAAQc3RzYwAAAAAAAAAAAAAAEHN0dHMAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAMZzdHNkAAAAAAAAAAEAAAC2YXZjMQAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAC0AUAASAAAAEgAAAAAAAAAAQtBVkMxIENvZGluZwAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAAAAAAAAAAAAClhdmNDAULAFf/hABJnQsAVjGgwKWfmoMDAwPCIRqABAARozjyAAAAAE2NvbHJuY2x4AAYABgAGAAAAAChtdmV4AAAAIHRyZXgAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAABobW9vZgAAABBtZmhkAAAAAAAAAAEAAABQdHJhZgAAABR0ZmhkAAIAIAAAAAEBAQAAAAAAFHRmZHQBAAAAAAAAAAAAAAAAAAAgdHJ1bgEAAwUAAAABAAAAcAIAAAAAAAPnAAABQwAAAUttZGF0AAABP2W4AAQFP//+HooABHycnJycnJycnJyfw//h7FB6666666666666666666666666666666666666666666666666666666666666//4/BbwE1NqtW2CdCMsNmnKKl4cGnK3LOv1ra2tra2trCz//AgW12r/XR9nXXCz2Cmd7/e/yxuU1zKa5lXuZV7m1tbW1tbW1tcP/+wV3j+IuJUGvcyr3MGa5lNc1109ddddddddPXXT1111111109ddPXXXXXXXXT114f8QwBgt4ENpobnxCMhLWHBpyty8NmnKKlnVatbW1tbW1tYWd//AnpPtX+uz6Ouu19LS0tLS0tLS2vrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrwAAABMbWZyYQAAADR0ZnJhAQAAAAAAAAEAAAA/AAAAAQAAAAAAAAAAAAAAAAAAAvAAAAABAAAAAQAAAAEAAAAQbWZybwAAAAAAAABM';

export type MediaFixture = {
  file: File;
  kind: 'image' | 'video';
  label: '图片' | '视频';
};

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Unable to create the PNG fixture.'));
    }, 'image/png');
  });
}

export async function createImageFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is unavailable.');
  }

  context.fillStyle = '#18181b';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f97316';
  context.fillRect(72, 96, 756, 570);
  context.fillStyle = '#d1fae5';
  context.fillRect(72, 714, 300, 300);
  context.fillStyle = '#fafafa';
  context.fillRect(420, 714, 408, 300);
  context.fillStyle = '#18181b';
  context.font = '600 48px system-ui, sans-serif';
  context.fillText('MEIYE CONTENT', 120, 188);
  context.font = '700 84px system-ui, sans-serif';
  context.fillText('PWA', 120, 318);
  context.fillText('PROOF', 120, 414);
  context.font = '500 32px system-ui, sans-serif';
  context.fillText('AI GENERATED FIXTURE', 120, 570);
  context.font = '600 38px system-ui, sans-serif';
  context.fillText('IMAGE', 468, 888);
  context.fillStyle = '#fafafa';
  context.font = '500 28px system-ui, sans-serif';
  context.fillText('2026 / MOBILE HANDOFF', 72, 1104);

  const blob = await canvasToPng(canvas);
  return new File([blob], IMAGE_FIXTURE_NAME, { type: 'image/png' });
}

function createVideoFile() {
  const binary = window.atob(VIDEO_FIXTURE_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], VIDEO_FIXTURE_NAME, { type: 'video/mp4' });
}

export async function createMediaFixtures(): Promise<MediaFixture[]> {
  return [
    { file: await createImageFixture(), kind: 'image', label: '图片' },
    { file: createVideoFile(), kind: 'video', label: '视频' },
  ];
}
