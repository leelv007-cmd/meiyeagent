import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { videoWorksurfaceFixture } from './video-worksurface-model';
import { VideoWorksurface } from './video-worksurface';

afterEach(() => cleanup());

describe('video result worksurface', () => {
  it('keeps viewing and selection while removing every video editing entry', () => {
    const { container } = render(
      <VideoWorksurface initialState={videoWorksurfaceFixture()} />
    );

    expect(screen.getByTestId('video-worksurface')).toBeInTheDocument();
    expect(screen.getByTestId('video-player')).toBeInTheDocument();
    expect(screen.getByTestId('video-storyboard')).toBeInTheDocument();
    expect(screen.getAllByTestId('video-shot')).toHaveLength(3);
    expect(screen.getByTestId('video-toggle-play')).toBeEnabled();
    expect(screen.getAllByTestId('video-shot-candidate')).not.toHaveLength(0);
    expect(screen.getByLabelText('后移镜头 1')).toBeInTheDocument();
    expect(screen.getByTestId('video-adopt-action')).toBeInTheDocument();
    expect(
      container.querySelector('video track[kind="captions"]')
    ).not.toBeInTheDocument();

    expect(screen.queryByTestId('video-cover-panel')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('video-subtitle-panel')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('video-shot-regenerate')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('video-full-recompose')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('video-pro-studio-refine')
    ).not.toBeInTheDocument();
  });

  it('adopts the candidate and opens delivery without inventing a receipt', async () => {
    const user = userEvent.setup();
    const onAdopt = vi.fn();
    const onDeliver = vi.fn();
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onAdopt={onAdopt}
        onDeliver={onDeliver}
      />
    );

    await user.click(screen.getByTestId('video-adopt-action'));
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('video-result-status')).toHaveTextContent(
      '已采用，待交付'
    );

    await user.click(screen.getByTestId('video-deliver-action'));
    expect(onDeliver).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('video-result-status')).toHaveTextContent(
      '已采用，待交付'
    );
  });

  it('persists candidate selection and deterministic shot order', async () => {
    const user = userEvent.setup();
    const onCanonicalEdit = vi.fn().mockResolvedValue(undefined);
    render(
      <VideoWorksurface
        initialState={{
          ...videoWorksurfaceFixture(),
          workflowStatus: 'awaiting_quality_review',
        }}
        onCanonicalEdit={onCanonicalEdit}
      />
    );

    await user.click(screen.getAllByTestId('video-shot-candidate')[1]!);
    expect(onCanonicalEdit).toHaveBeenLastCalledWith({
      candidateIndex: 1,
      expectedRevision: 3,
      kind: 'select_candidate',
      shotId: 'shot-opening',
      workflowId: 'wf-video-fixture-1',
    });

    await user.click(screen.getByLabelText('后移镜头 1'));
    expect(onCanonicalEdit).toHaveBeenLastCalledWith({
      expectedRevision: 3,
      kind: 'reorder_shots',
      shotIds: ['shot-service', 'shot-opening', 'shot-cta'],
      workflowId: 'wf-video-fixture-1',
    });
  });

  it('keeps terminal results viewable while preventing candidate mutation', () => {
    render(
      <VideoWorksurface
        initialState={videoWorksurfaceFixture()}
        onCanonicalEdit={vi.fn()}
      />
    );

    expect(screen.getByTestId('video-result-status')).toHaveTextContent(
      '成片待确认'
    );
    expect(screen.getByTestId('video-toggle-play')).toBeEnabled();
    expect(screen.getAllByTestId('video-shot-candidate')[1]).toBeDisabled();
    expect(screen.getByLabelText('后移镜头 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /重新生成/u })).toBeNull();
  });
});
