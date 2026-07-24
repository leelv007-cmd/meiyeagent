/**
 * react-resizable-panels 4.6.4 → 4.12.2 regression proof — C-02 blocker #3.
 *
 * HeroUI Pro's AppLayout peer-requires >=4.10.0, so T30 cannot swap the shell
 * until this app moves off ^4.6.4. The only existing usage surface is
 * src/components/ui/resizable.tsx (shadcn, currently unreferenced), so tsc alone
 * would prove nothing more than that the type names still exist. This mounts
 * the real thing instead: the Group/Panel/Separator trio has to render, expose
 * the data-slot and ARIA contract, and take focus under the new version.
 *
 *   pnpm --filter @meiye/web test:interaction
 *
 * The seam directory owns this file rather than src/components/ui/ because the
 * upgrade is a HeroUI Pro prerequisite; the shadcn tree stays untouched, and
 * T30 is still the owner of vendoring app-layout/resizable themselves.
 */
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';

/**
 * The library reaches for `ownerDocument.defaultView.ResizeObserver`, which
 * jsdom does not implement. 4.6.4 read the same property, so this is a jsdom
 * gap the upgrade neither introduced nor widened — stubbing it keeps the test
 * about the library instead of about the environment.
 */
beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function TwoPaneSample() {
  return (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel defaultSize={40} minSize={20}>
        侧栏
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="调整宽度" />
      <ResizablePanel defaultSize={60} minSize={20}>
        主区
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

describe('react-resizable-panels 4.12.2 keeps the shadcn resizable surface', () => {
  it('renders the group, both panels and a focusable separator', () => {
    const { container } = render(<TwoPaneSample />);

    // The library keeps its contract on data attributes, not roles, so the
    // shadcn wrapper's data-slot hooks are what a consumer actually styles.
    const group = container.querySelector(
      '[data-slot="resizable-panel-group"]'
    );
    expect(group).toHaveAttribute('data-group', 'true');
    expect(group).toHaveStyle({ flexDirection: 'row' });
    expect(
      container.querySelectorAll('[data-slot="resizable-panel"]')
    ).toHaveLength(2);
    expect(screen.getByText('侧栏')).toBeInTheDocument();
    expect(screen.getByText('主区')).toBeInTheDocument();

    const separator = screen.getByRole('separator', { name: '调整宽度' });
    expect(separator).toHaveAttribute('data-slot', 'resizable-handle');
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-controls');
    expect(separator).toHaveAttribute('aria-valuenow');

    // Reachable by keyboard, which is the part of the drag contract jsdom can
    // still answer for. Actually dragging needs a layout engine — jsdom lays
    // everything out at zero size and 4.12 throws "Previous layout not found"
    // — so a real resize belongs in Playwright once T30 renders one.
    separator.focus();
    expect(separator).toHaveFocus();
  });
});
