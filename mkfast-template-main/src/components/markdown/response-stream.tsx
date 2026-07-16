import { cjk } from '@streamdown/cjk';
import { memo } from 'react';
import { Streamdown } from 'streamdown';

/**
 * Adapted from prompt-kit ResponseStream at commit
 * de80375967400aa0c6ebab9d3ba4f9258ab79fcc (MIT).
 *
 * The upstream client-side typewriter is deliberately omitted. This variant
 * renders only text already received from the server so a complete response is
 * never replayed as fake streaming. See THIRD_PARTY_NOTICES.md.
 */
type ResponseStreamBodyProps = {
  children: string;
  className?: string;
  streaming: boolean;
};

export function sameResponseStreamChildren(
  previous: Pick<ResponseStreamBodyProps, 'children'>,
  next: Pick<ResponseStreamBodyProps, 'children'>
) {
  return previous.children === next.children;
}

const plugins = { cjk };
const linkSafety = { enabled: false } as const;

const ResponseStreamBody = memo(function ResponseStreamBody({
  children,
  className,
  streaming,
}: ResponseStreamBodyProps) {
  return (
    <Streamdown
      className={className}
      controls={false}
      caret={streaming ? 'block' : undefined}
      linkSafety={linkSafety}
      mode={streaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={streaming}
      plugins={plugins}
      skipHtml
    >
      {children}
    </Streamdown>
  );
}, sameResponseStreamChildren);

export function ResponseStream(props: ResponseStreamBodyProps) {
  return (
    <ResponseStreamBody
      {...props}
      key={`${props.streaming ? 'streaming' : 'static'}:${props.className ?? ''}`}
    />
  );
}
