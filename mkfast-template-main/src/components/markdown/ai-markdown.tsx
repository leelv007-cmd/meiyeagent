import parse, { type HTMLReactParserOptions } from 'html-react-parser';
import { useEffect, useState } from 'react';

import { renderAiMarkdown, type MarkdownResult } from '@/lib/markdown';
import { ResponseStream } from './response-stream';

type AiMarkdownProps = {
  content: string;
  className?: string;
};

/** Safe completed-state renderer for persisted model output. */
export function AiMarkdown({ content, className }: AiMarkdownProps) {
  const [result, setResult] = useState<MarkdownResult | null>(null);

  useEffect(() => {
    let current = true;
    setResult(null);
    void renderAiMarkdown(content).then((next) => {
      if (current) setResult(next);
    });
    return () => {
      current = false;
    };
  }, [content]);

  if (!result) {
    return <div className={className} aria-busy="true" />;
  }

  const options: HTMLReactParserOptions = {
    replace: (node) => {
      if (node.type !== 'tag' || node.name !== 'a') return;
      node.attribs.target = '_blank';
      node.attribs.rel = 'noreferrer noopener';
    },
  };

  return <div className={className}>{parse(result.markup, options)}</div>;
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
  return (
    <ResponseStream className={className} streaming={streaming}>
      {content}
    </ResponseStream>
  );
}
