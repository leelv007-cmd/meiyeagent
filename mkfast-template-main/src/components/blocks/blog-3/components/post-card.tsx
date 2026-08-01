import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

import type { BlogPost } from './data';

export function PostCard({ post }: { post: BlogPost }) {
  return (
    <article className="group flex min-w-0 flex-col gap-3.5">
      <Card className="overflow-hidden p-0 shadow-none">
        <a
          href="#"
          aria-label={`Read ${post.title}`}
          className="focus-visible:ring-ring block outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <AspectRatio ratio={16 / 9} className="bg-muted overflow-hidden">
            <img
              src={post.cover}
              alt={post.coverAlt}
              width={960}
              height={640}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out motion-safe:group-hover:scale-105 motion-reduce:transition-none"
            />
          </AspectRatio>
        </a>
      </Card>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge
            variant="ghost"
            render={
              // biome-ignore lint/a11y/useAnchorContent: Base UI render prop slots the badge children into this anchor at render time, and aria-label covers screen readers.
              <a href="#" aria-label={`View ${post.category} articles`} />
            }
            className="text-primary hover:text-primary gap-1.5 px-0 font-semibold hover:bg-transparent focus-visible:bg-transparent"
          >
            <span
              className="bg-primary size-1.5 rounded-full"
              aria-hidden="true"
            />
            {post.category}
          </Badge>
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span className="text-muted-foreground shrink-0 text-xs font-medium">
            {post.readTime}
          </span>
        </div>

        <h2 className="text-foreground text-lg leading-snug font-semibold text-balance md:text-xl">
          <a
            href="#"
            className="hover:text-primary focus-visible:text-primary underline-offset-4 transition-colors hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {post.title}
          </a>
        </h2>
      </div>
    </article>
  );
}
