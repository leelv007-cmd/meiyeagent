/**
 * Model output, rendered as rich text.
 *
 * U03: both renderers are now the HeroUI Pro V3 `markdown` unit (itself a
 * Streamdown / react-markdown wrapper plus the `code-block` unit, so fenced
 * code arrives highlighted and copyable). The local prompt-kit `ResponseStream`
 * adaptation this replaced was the same wrapper written a second time, minus
 * the code block.
 *
 * 「无假流式」survives the swap, and is why `isStreaming` is wired to the
 * caller's real stream phase rather than to «is there content»: the renderer
 * only ever shows text Core has already sent, and a completed response is
 * never replayed character by character. `animated` is the reveal of blocks
 * that just arrived — switched off entirely for a merchant who asked for
 * reduced motion, since that reveal runs from JS and a stylesheet cannot
 * flatten it.
 *
 * Raw HTML in model output stays inert: neither renderer enables `rehype-raw`,
 * so tags arrive as text, and react-markdown's default URL transform drops
 * `javascript:` links. `ai-markdown.test.tsx` holds both to that.
 */

import { Markdown, StreamMarkdown } from '@/components/heroui-pro';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

type AiMarkdownProps = {
  content: string;
  className?: string;
};

/** Completed-state renderer for persisted model output. */
export function AiMarkdown({ content, className }: AiMarkdownProps) {
  return <Markdown className={className}>{content}</Markdown>;
}

type StreamingAiMarkdownProps = AiMarkdownProps & {
  streaming: boolean;
};

/** Incremental renderer. It only presents content already received from Core. */
export function StreamingAiMarkdown({
  content,
  className,
  streaming,
}: StreamingAiMarkdownProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <StreamMarkdown
      animated={prefersReducedMotion ? false : undefined}
      className={className}
      isStreaming={streaming}
    >
      {content}
    </StreamMarkdown>
  );
}
