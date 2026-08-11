import { Markdown } from '@/components/heroui-pro';
import { Card, CardContent } from '@/components/ui/card';
import type { PageDoc } from '@/lib/pages';
import { formatDate } from '@/lib/formatter';
import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';

function headingId(children: ReactNode): string {
  return String(children)
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-');
}

function anchoredHeading(tag: keyof Pick<Components, `h${1 | 2 | 3 | 4 | 5 | 6}`>) {
  const Heading = tag;
  return ({ children }: { children?: ReactNode }) => {
    const id = headingId(children);
    return (
      <Heading id={id}>
        <a className="anchor" href={`#${id}`}>
          {children}
        </a>
      </Heading>
    );
  };
}

const LEGAL_MARKDOWN_COMPONENTS = {
  h1: anchoredHeading('h1'),
  h2: anchoredHeading('h2'),
  h3: anchoredHeading('h3'),
  h4: anchoredHeading('h4'),
  h5: anchoredHeading('h5'),
  h6: anchoredHeading('h6'),
} satisfies Components;

export function MarkdownPage({ page }: { page: PageDoc }) {
  const { title, description, date, content } = page;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-4">
        <h1 className="text-center text-3xl font-bold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-center text-lg text-muted-foreground">
            {description}
          </p>
        )}
        {date && (
          <p className="text-center text-sm text-muted-foreground">
            {formatDate(new Date(date))}
          </p>
        )}
      </div>
      <Card className="ring-0 border border-border">
        <CardContent>
          <Markdown
            className="prose prose-neutral dark:prose-invert max-w-none"
            components={LEGAL_MARKDOWN_COMPONENTS}
          >
            {content}
          </Markdown>
        </CardContent>
      </Card>
    </div>
  );
}
