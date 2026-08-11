import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerImageInput } from './composer-image-input';
import {
  confirmedAssetFacts,
  ordinaryOneClickAnswers,
} from './creation-entry-model';

afterEach(cleanup);

function pngFile(name = 'case.png') {
  // Minimal valid 1×1 PNG.
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return new File([bytes], name, { type: 'image/png' });
}

describe('ComposerImageInput one-click public authorize (V31-52)', () => {
  it('shows ready copy after a successful public-marketing upload', async () => {
    const onUpload = vi.fn(async () => ({ attached: true as const }));
    const onAssetAdded = vi.fn();
    const onAuthorize = vi.fn(async () => undefined);
    const onQueueChange = vi.fn();

    render(
      <ComposerImageInput
        focusRef={createRef<HTMLElement>()}
        onAssetAdded={onAssetAdded}
        onAssetRemoved={() => undefined}
        onAuthorize={onAuthorize}
        onQueueChange={onQueueChange}
        onUpload={onUpload}
      >
        <span>hint</span>
      </ComposerImageInput>
    );

    const input = document.getElementById(
      'composer-gallery-input'
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    await userEvent.upload(input, pngFile());

    const yes = await screen.findByRole('button', {
      name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
    });
    await userEvent.click(yes);

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getAllByText(/已保存到素材库|Saved to assets/).length
      ).toBeGreaterThan(0);
    });
    expect(onAssetAdded).toHaveBeenCalledTimes(1);

    const facts = confirmedAssetFacts(
      ordinaryOneClickAnswers({
        confirmsNoPeopleBeforeAfterCustomerCaseOrSensitiveData: true,
        consentScope: 'public_marketing',
      })!,
      { evidenceContext: 'composer', evidenceNonce: 'x' }
    );
    expect(facts?.consentScope).toBe('public_marketing');
  });

  it('does not claim ready when the upload path fails', async () => {
    const onUpload = vi.fn(async () => {
      throw new Error('storage down');
    });

    render(
      <ComposerImageInput
        focusRef={createRef<HTMLElement>()}
        onAssetAdded={() => undefined}
        onAssetRemoved={() => undefined}
        onAuthorize={async () => undefined}
        onQueueChange={() => undefined}
        onUpload={onUpload}
      >
        <span>hint</span>
      </ComposerImageInput>
    );

    const input = document.getElementById(
      'composer-gallery-input'
    ) as HTMLInputElement;
    await userEvent.upload(input, pngFile());
    await userEvent.click(
      await screen.findByRole('button', {
        name: /确认：允许公开宣传|Confirm public use|是，可用于公开宣传/,
      })
    );

    await waitFor(() => {
      expect(onUpload).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText(/图片上传失败|Image upload failed/)).toBeTruthy();
    });
    expect(screen.queryByText(/已保存到素材库|Saved to assets/)).toBeNull();
  });
});
