import { expect, type Page } from '@playwright/test';

/**
 * Measured contrast, not declared contrast. Two reads of the same box: one with
 * the text hidden gives the backdrop actually painted there — ambient photo,
 * scrim and glass included, which no computed style can tell you — and the text
 * colour is composited over that mean before the WCAG ratio is taken.
 *
 * The screenshot goes back into the page as a data URL so the browser decodes
 * the PNG; there is no image decoder on the node side of this repo.
 *
 * Lifted verbatim from the private helper in specs/works-reshell.spec.ts (T32 /
 * #226) so T46 can hold the 作品面 empty state to the same measured bar without a
 * second implementation of the same arithmetic. `tokens` is parameterised only
 * because each caller wants a different set named back in its failure message;
 * the default is T32's list, so that spec can drop its copy for this import
 * without changing a single number it reports.
 */
export async function measureContrast(
  page: Page,
  testId: string,
  tokenNames: readonly string[] = ['--muted', '--ink-60', '--ambient-text']
) {
  const target = page.getByTestId(testId);
  await expect(target).toBeVisible({ timeout: 30_000 });

  // The declared colour is painted, never parsed. getComputedStyle hands back
  // `oklch(…)` for oklch-authored colours, and reading those three numbers as
  // if they were r,g,b turns white text into black — a mistake that reports a
  // readable surface as 1.01:1 and an unreadable one as a pass.
  const color = await target.evaluate(
    (node) => getComputedStyle(node as Element).color
  );
  // What the element resolved the relevant tokens to, so a failing sample says
  // which token missed rather than only that the number is too low.
  const tokens = await target.evaluate(
    (node, names) => {
      const style = getComputedStyle(node as Element);
      return names
        .map((name) => `${name}=${style.getPropertyValue(name).trim() || '∅'}`)
        .join(' ');
    },
    [...tokenNames]
  );
  // Element screenshots clip and scroll themselves, so no viewport/page
  // coordinate arithmetic can drift. Transparent text keeps the box laid out
  // exactly as it was while letting the backdrop through.
  await target.evaluate((node) => {
    (node as HTMLElement).style.color = 'transparent';
  });
  const backdropShot = await target.screenshot();
  await target.evaluate((node) => {
    (node as HTMLElement).style.color = '';
  });

  return page
    .evaluate(
      async ([dataUrl, cssColor]) => {
        const image = new Image();
        image.src = dataUrl!;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );
        const backdrop = [0, 1, 2].map((channel) => {
          let total = 0;
          for (let index = channel; index < data.length; index += 4)
            total += data[index]!;
          return Math.round(total / (data.length / 4));
        }) as [number, number, number];

        // Composite the declared colour over that backdrop by painting both, so
        // the browser does the colour-space conversion and the alpha blend.
        const swatch = document.createElement('canvas');
        swatch.width = 1;
        swatch.height = 1;
        const paint = swatch.getContext('2d')!;
        paint.fillStyle = `rgb(${backdrop[0]}, ${backdrop[1]}, ${backdrop[2]})`;
        paint.fillRect(0, 0, 1, 1);
        paint.fillStyle = cssColor!;
        paint.fillRect(0, 0, 1, 1);
        const painted = paint.getImageData(0, 0, 1, 1).data;
        const foreground = [painted[0]!, painted[1]!, painted[2]!] as [
          number,
          number,
          number,
        ];

        const luminance = (rgb: [number, number, number]) => {
          const [r, g, b] = rgb.map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          }) as [number, number, number];
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const first = luminance(foreground);
        const second = luminance(backdrop);
        const ratio =
          (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
        return {
          backdrop,
          color: cssColor!,
          foreground,
          ratio: Math.round(ratio * 100) / 100,
        };
      },
      [
        `data:image/png;base64,${backdropShot.toString('base64')}`,
        color,
      ] as const
    )
    .then((sample) => ({ ...sample, tokens }));
}
