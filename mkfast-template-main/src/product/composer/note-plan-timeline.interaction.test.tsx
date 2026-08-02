/**
 * RTL: multi-page note outline timeline (#319 / P1-5).
 * Fixture path — edit ≥1 page outline and show image status.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerConversation } from './composer-conversation';
import {
  applyComposerNotePlan,
  applyComposerProgress,
  bindComposerTask,
  createComposerSession,
  openComposerTurn,
  updateComposerNotePlan,
  type ComposerSession,
} from './composer-session';
import {
  editNotePlanPageOutline,
  projectNotePlanTimelineFromPlan,
  requestNotePlanPageRegenerate,
  type NotePlanTimeline,
} from './note-plan-timeline';
import { projectResultTokenStream } from '@/product/results/result-token-stream';
import type { NotePlan, WorkflowProgressEnvelope } from '@meiye/contracts';

afterEach(cleanup);

const TASK = {
  taskId: 'task-note',
  workId: 'work-note',
  packageId: 'pkg-note',
};
const emptyStream = projectResultTokenStream({ workspaceKind: 'copy' });

function page(input: {
  id: string;
  order: number;
  pageRole: 'cover' | 'solution_show';
  pagePurpose: 'capture_attention' | 'explain_solution';
  title: string;
  body: string;
}): NotePlan['pages'][number] {
  return {
    id: input.id,
    order: input.order,
    revision: 1,
    pageRole: input.pageRole,
    pagePurpose: input.pagePurpose,
    textBlock: {
      title: input.title,
      body: input.body,
      exactText: [input.title],
    },
    imageIntent: {
      operation: 'image.generate',
      purpose: `${input.pageRole}配图`,
      subject: '门店护理项目',
      scene: '真实门店场景',
      composition: '主体清晰',
      references: [],
      exactText: [{ text: input.title, treatment: 'exact' }],
      changes: [],
      invariants: [],
      factRefs: [],
      rightsRefs: [],
      outputPlan: { kind: 'single' },
    },
    dependencies:
      input.order === 1
        ? []
        : [{ pageId: 'page-1', kind: 'text_sequence' as const }],
  };
}

function fixtureTimeline(): NotePlanTimeline {
  const plan: NotePlan = {
    schema: 'note-plan/v1',
    themeAnchor: '夏日补水图文笔记',
    style: {
      id: 'practical_guide',
      name: '干货科普版',
      positioning: '清楚可信',
    },
    pages: [
      page({
        id: 'page-1',
        order: 1,
        pageRole: 'cover',
        pagePurpose: 'capture_attention',
        title: '封面标题',
        body: '封面导语',
      }),
      page({
        id: 'page-2',
        order: 2,
        pageRole: 'solution_show',
        pagePurpose: 'explain_solution',
        title: '方案页',
        body: '方案正文',
      }),
    ],
  };
  return projectNotePlanTimelineFromPlan(plan, {
    styleId: 'practical_guide',
    styleName: '干货科普版',
  });
}

function sessionWithNotePlan(
  timeline: NotePlanTimeline,
  phase: ComposerSession['phase'] = 'running'
): ComposerSession {
  let session = openComposerTurn(
    createComposerSession('session-note'),
    '做一组小红书图文'
  );
  session = bindComposerTask(session, TASK);
  session = applyComposerNotePlan(session, timeline);
  // L1-3: outline edit / regenerate are delivered-only; running mounts readonly.
  return { ...session, phase };
}

function progress(
  overrides: Partial<WorkflowProgressEnvelope> & { sequence: number }
): WorkflowProgressEnvelope {
  return {
    eventId: `workflow-1:event:${overrides.sequence}`,
    workflowId: 'workflow-1',
    workflowType: 'creation',
    stage: 'execution_selection',
    state: 'running',
    occurredAt: '2026-08-01T08:00:00.000Z',
    message: '正在配图',
    ...overrides,
  };
}

describe('NotePlan multi-page timeline (P1-5)', () => {
  it('renders plan AgentFrame with editable outline and image status when delivered', () => {
    // Reason: L1-3 keeps edit/regenerate delivered-only; prior assertion assumed
    // editable during any mounted phase.
    const onEdit = vi.fn();
    const onRegen = vi.fn();
    const session = sessionWithNotePlan(fixtureTimeline(), 'delivered');

    render(
      <ComposerConversation
        onNotePlanOutlineEdit={onEdit}
        onNotePlanRegeneratePage={onRegen}
        onOpenDelivery={() => undefined}
        session={session}
        stream={emptyStream}
      />
    );

    const host = screen.getByTestId('composer-note-plan-turn');
    expect(host).toHaveAttribute('data-agent-frame', 'plan');
    expect(host).toHaveAttribute('data-turn-kind', 'note_plan');
    expect(screen.getByTestId('note-plan-timeline-frame')).toBeInTheDocument();
    expect(screen.getByTestId('note-plan-theme-anchor')).toHaveTextContent(
      '夏日补水图文笔记'
    );

    const rows = screen.getAllByTestId('note-plan-page-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-image-status', 'pending');

    const titleInput = screen.getAllByTestId('note-plan-page-title-input')[0]!;
    fireEvent.change(titleInput, { target: { value: '改过的封面' } });
    expect(onEdit).toHaveBeenCalledWith({
      pageId: 'page-1',
      title: '改过的封面',
      body: '封面导语',
    });

    fireEvent.click(screen.getAllByTestId('note-plan-page-regenerate')[0]!);
    expect(onRegen).toHaveBeenCalledWith('page-1');
  });

  it('mounts readonly timeline during running and advances page status by frame', () => {
    let session = openComposerTurn(
      createComposerSession('session-note-running'),
      '做一组小红书图文'
    );
    session = bindComposerTask(session, TASK);
    session = { ...session, phase: 'running' };
    session = applyComposerProgress(
      session,
      progress({
        sequence: 1,
        stage: 'brief_compilation',
        state: 'success',
        message: '已选方向',
        notePlanPreview: {
          styleId: 'practical_guide',
          styleName: '干货科普版',
          themeAnchor: '夏日补水图文笔记',
          pages: [
            {
              pageId: 'page-1',
              order: 1,
              pageRole: 'cover',
              title: '封面标题',
              body: '封面导语',
            },
            {
              pageId: 'page-2',
              order: 2,
              pageRole: 'solution_show',
              title: '方案页',
              body: '方案正文',
            },
          ],
        },
      })
    );

    const { rerender } = render(
      <ComposerConversation
        onNotePlanOutlineEdit={vi.fn()}
        onNotePlanRegeneratePage={vi.fn()}
        onOpenDelivery={() => undefined}
        session={session}
        stream={emptyStream}
      />
    );

    expect(screen.getByTestId('composer-note-plan-turn')).toBeInTheDocument();
    expect(screen.getAllByTestId('note-plan-page-row')).toHaveLength(2);
    // Running-phase: no regenerate control (delivered-only).
    expect(screen.queryByTestId('note-plan-page-regenerate')).toBeNull();
    const titleInput = screen.getAllByTestId('note-plan-page-title-input')[0]!;
    expect(titleInput).toBeDisabled();

    session = applyComposerProgress(
      session,
      progress({
        sequence: 2,
        state: 'running',
        pageId: 'page-1',
        message: '正在生成第 1 页配图',
      })
    );
    session = applyComposerProgress(
      session,
      progress({
        sequence: 3,
        state: 'success',
        pageId: 'page-1',
        message: '第 1 页配图已完成',
      })
    );
    session = applyComposerProgress(
      session,
      progress({
        sequence: 4,
        state: 'running',
        pageId: 'page-2',
        message: '正在生成第 2 页配图',
      })
    );
    rerender(
      <ComposerConversation
        onOpenDelivery={() => undefined}
        session={session}
        stream={emptyStream}
      />
    );

    const rows = screen.getAllByTestId('note-plan-page-row');
    expect(rows[0]).toHaveAttribute('data-image-status', 'ready');
    expect(rows[1]).toHaveAttribute('data-image-status', 'generating');
  });

  it('shows generating image status after batch execution_selection progress', () => {
    let session = sessionWithNotePlan(fixtureTimeline());
    session = applyComposerProgress(
      session,
      progress({ sequence: 1, state: 'running', message: '批量配图中' })
    );

    render(
      <ComposerConversation
        onOpenDelivery={() => undefined}
        session={session}
        stream={emptyStream}
      />
    );

    const rows = screen.getAllByTestId('note-plan-page-row');
    for (const row of rows) {
      expect(row).toHaveAttribute('data-image-status', 'generating');
    }
    expect(
      screen.getAllByTestId('note-plan-page-image-status')[0]
    ).toHaveTextContent('配图中');
  });

  it('session helpers apply outline edit and regenerate on the mounted turn', () => {
    let session = sessionWithNotePlan(fixtureTimeline());
    const noteTurn = session.turns.find((turn) => turn.kind === 'note_plan');
    expect(noteTurn?.kind).toBe('note_plan');
    if (!noteTurn || noteTurn.kind !== 'note_plan') {
      throw new Error('expected note_plan turn');
    }

    session = updateComposerNotePlan(
      session,
      editNotePlanPageOutline(noteTurn.timeline, {
        pageId: 'page-1',
        title: '新标题',
      })
    );
    const edited = session.turns.find((turn) => turn.kind === 'note_plan');
    expect(edited?.kind).toBe('note_plan');
    if (edited?.kind === 'note_plan') {
      expect(edited.timeline.pages[0]?.title).toBe('新标题');
      expect(edited.timeline.pages[0]?.outlineDirty).toBe(true);
    }

    session = updateComposerNotePlan(
      session,
      requestNotePlanPageRegenerate(
        (
          session.turns.find((turn) => turn.kind === 'note_plan') as {
            kind: 'note_plan';
            timeline: NotePlanTimeline;
          }
        ).timeline,
        'page-2'
      )
    );
    const regen = session.turns.find((turn) => turn.kind === 'note_plan');
    if (regen?.kind === 'note_plan') {
      expect(regen.timeline.pages[1]?.imageStatus).toBe('generating');
      expect(regen.timeline.pages[1]?.regenerateRequested).toBe(true);
    }
  });

  it('exposes canonical outline save and a retryable failure exit', () => {
    // Reason: L1-3 limits outline save UI to delivered phase.
    const onSave = vi.fn();
    let session = sessionWithNotePlan(fixtureTimeline(), 'delivered');
    const noteTurn = session.turns.find((turn) => turn.kind === 'note_plan');
    if (!noteTurn || noteTurn.kind !== 'note_plan') {
      throw new Error('expected note_plan turn');
    }
    session = updateComposerNotePlan(
      session,
      editNotePlanPageOutline(noteTurn.timeline, {
        pageId: 'page-1',
        title: '等待服务端保存的标题',
      })
    );

    render(
      <ComposerConversation
        notePlanOutlineSaveError={{
          message: '保存失败，请刷新后重试。',
          pageId: 'page-1',
        }}
        onNotePlanOutlineSave={onSave}
        onOpenDelivery={() => undefined}
        session={session}
        stream={emptyStream}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '保存失败，请刷新后重试。'
    );
    fireEvent.click(screen.getByTestId('note-plan-page-save-outline'));
    expect(onSave).toHaveBeenCalledWith('page-1');
  });
});
