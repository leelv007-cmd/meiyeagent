/**
 * Interaction: task-in experience surfaces with / without producers (#325).
 */
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExperienceBasisSurface,
  ExperienceCorrectionSurface,
  ExperienceSedimentSurface,
} from './task-experience-surfaces';
import type {
  ExperienceBasisProjection,
  ExperienceCorrectionProjection,
  ExperienceSedimentProjection,
} from './task-experience';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe('ExperienceBasisSurface', () => {
  it('renders chips when the producer supplied them', () => {
    const projection: ExperienceBasisProjection = {
      state: 'ready',
      chips: [
        { id: 'identity', label: '主理人口吻' },
        { id: 'e1', label: '少促销感' },
      ],
    };
    render(<ExperienceBasisSurface projection={projection} />);
    expect(screen.getByTestId('experience-basis-surface')).toHaveAttribute(
      'data-agent-frame',
      'memory'
    );
    expect(screen.getByTestId('experience-basis-chips')).toHaveTextContent(
      '主理人口吻'
    );
    expect(screen.getByTestId('experience-basis-chip-e1')).toHaveTextContent(
      '少促销感'
    );
    expect(screen.queryByTestId('experience-basis-empty')).toBeNull();
  });

  it('honest empty when producer settled with nothing', () => {
    const projection: ExperienceBasisProjection = {
      state: 'empty',
      chips: [],
    };
    render(<ExperienceBasisSurface projection={projection} />);
    expect(screen.getByTestId('experience-basis-empty')).toBeInTheDocument();
    expect(screen.getByTestId('experience-basis-open-vault')).toHaveAttribute(
      'href',
      '/dashboard/memory'
    );
    expect(screen.queryByTestId('experience-basis-chips')).toBeNull();
  });
});

describe('ExperienceSedimentSurface', () => {
  it('renders pending suggestions when producer has them', () => {
    const projection: ExperienceSedimentProjection = {
      state: 'ready',
      items: [{ id: 'p1', label: '私信了解' }],
    };
    render(
      <ExperienceSedimentSurface
        onKeepLater={() => {}}
        onThisTimeOnly={() => {}}
        projection={projection}
      />
    );
    expect(
      screen.getByTestId('experience-sediment-item-p1')
    ).toHaveTextContent('私信了解');
    expect(screen.getByTestId('experience-sediment-later-p1')).toBeTruthy();
    expect(screen.queryByTestId('experience-sediment-empty')).toBeNull();
  });

  it('honest empty when no sedimentation proposals', () => {
    const projection: ExperienceSedimentProjection = {
      state: 'empty',
      items: [],
    };
    render(<ExperienceSedimentSurface projection={projection} />);
    expect(screen.getByTestId('experience-sediment-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('experience-sediment-items')).toBeNull();
  });
});

describe('ExperienceCorrectionSurface', () => {
  it('honest empty without classification producer', () => {
    const projection: ExperienceCorrectionProjection = {
      state: 'empty',
      kind: null,
      summary: null,
    };
    render(<ExperienceCorrectionSurface projection={projection} />);
    expect(
      screen.getByTestId('experience-correction-empty')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('experience-correction-ready')).toBeNull();
  });

  it('distinguishes fact vs task_only when producer classifies', () => {
    const fact: ExperienceCorrectionProjection = {
      state: 'ready',
      kind: 'fact',
      summary: '她是店长',
    };
    const { rerender } = render(
      <ExperienceCorrectionSurface projection={fact} />
    );
    const ready = screen.getByTestId('experience-correction-ready');
    expect(ready).toHaveAttribute('data-correction-kind', 'fact');
    expect(ready).toHaveTextContent('她是店长');

    const taskOnly: ExperienceCorrectionProjection = {
      state: 'ready',
      kind: 'task_only',
      summary: '这次不要写价格',
    };
    rerender(<ExperienceCorrectionSurface projection={taskOnly} />);
    expect(screen.getByTestId('experience-correction-ready')).toHaveAttribute(
      'data-correction-kind',
      'task_only'
    );
  });
});
