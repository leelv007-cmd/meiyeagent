import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { landing_blurb } from '@/locale/paraglide/messages';

/** CJK text has no spaces — split per character instead of per word. */
const CJK = /[一-鿿]/u;

export function BlurInHeadline(): ReactNode {
  const containerRef = useRef<HTMLElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const text = landing_blurb();
  const isCjk = CJK.test(text);
  const words = isCjk ? Array.from(text) : text.split(' ');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const windowHeight = window.innerHeight;

        const startOffset = windowHeight * 0.9;
        const endOffset = windowHeight * 0.25;

        const progress = Math.min(
          1,
          Math.max(0, (startOffset - rect.top) / (startOffset - endOffset))
        );

        setScrollProgress(progress);
        ticking = false;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <section ref={containerRef} className="w-full bg-background px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <p className="text-3xl font-medium text-left leading-snug tracking-tight text-foreground sm:text-4xl lg:text-5xl lg:leading-snug">
          {words.map((word, index) => {
            const wordStart = index / words.length;
            const wordEnd = wordStart + 1 / words.length;

            const wordProgress = Math.min(
              1,
              Math.max(0, (scrollProgress - wordStart) / (wordEnd - wordStart))
            );
            const opacity = 0.15 + wordProgress * 0.85;
            const blur = (1 - wordProgress) * 8;

            return (
              <span
                key={index}
                className={isCjk ? 'inline-block' : 'mr-2 inline-block lg:mr-3'}
                style={{
                  opacity,
                  filter: `blur(${blur}px)`,
                  transition: 'opacity 75ms, filter 75ms',
                }}
              >
                {word}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}
