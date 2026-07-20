import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  landing_gallery_alt_1,
  landing_gallery_alt_2,
  landing_gallery_alt_3,
  landing_gallery_alt_4,
  landing_gallery_alt_5,
  landing_gallery_alt_6,
  landing_gallery_alt_7,
  landing_gallery_alt_8,
  landing_gallery_alt_9,
  landing_gallery_alt_10,
  landing_gallery_alt_11,
  landing_gallery_alt_12,
} from '@/locale/paraglide/messages';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

interface ImageRevealProps {
  images?: {
    src: string;
    alt: string;
  }[];
  className?: string;
}

export function ImageReveal({
  images,
  className = '',
}: ImageRevealProps): ReactNode {
  const defaultImages = [
    // Column 0
    {
      src: '/seed/scene/scene-seeding-hair.webp',
      alt: landing_gallery_alt_1(),
    },
    {
      src: '/seed/scene/scene-seeding-nail.webp',
      alt: landing_gallery_alt_2(),
    },
    {
      src: '/seed/scene/scene-seeding-skin.webp',
      alt: landing_gallery_alt_3(),
    },
    {
      src: '/seed/scene/scene-lead-gen-hair.webp',
      alt: landing_gallery_alt_4(),
    },
    // Column 1
    {
      src: '/seed/scene/scene-lead-gen-nail.webp',
      alt: landing_gallery_alt_5(),
    },
    {
      src: '/seed/scene/scene-lead-gen-skin.webp',
      alt: landing_gallery_alt_6(),
    },
    { src: '/seed/scene/scene-promo-nail.webp', alt: landing_gallery_alt_7() },
    {
      src: '/seed/scene/scene-retention-nail.webp',
      alt: landing_gallery_alt_8(),
    },
    // Column 2
    {
      src: '/seed/template/template-before-after.webp',
      alt: landing_gallery_alt_9(),
    },
    {
      src: '/seed/template/template-event.webp',
      alt: landing_gallery_alt_10(),
    },
    {
      src: '/seed/template/template-store-visit.webp',
      alt: landing_gallery_alt_11(),
    },
    {
      src: '/seed/template/template-tutorial.webp',
      alt: landing_gallery_alt_12(),
    },
  ];

  const resolvedImages = images ?? defaultImages;
  const containerRef = useRef<HTMLDivElement>(null);

  const columns: [
    { src: string; alt: string }[],
    { src: string; alt: string }[],
    { src: string; alt: string }[],
  ] = [[], [], []];
  resolvedImages.forEach((image, index) => {
    columns[index % 3]!.push(image);
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      const columnEls = containerRef.current!.querySelectorAll('.column');

      columnEls.forEach((column, columnIndex) => {
        const items = column.querySelectorAll('.column__item');

        items.forEach((item) => {
          const wrapper = item.querySelector('.column__item-imgwrap');
          if (!wrapper) return;

          let xPercentValue: number;
          let scaleXValue: number;
          let scaleYValue: number;
          let transformOrigin: string;
          let filterValue: string;

          switch (columnIndex) {
            case 0:
              xPercentValue = -400;
              transformOrigin = '0% 50%';
              scaleXValue = 6;
              scaleYValue = 0.3;
              filterValue = 'blur(10px)';
              break;
            case 1:
              xPercentValue = 0;
              transformOrigin = '50% 50%';
              scaleXValue = 0.7;
              scaleYValue = 0.7;
              filterValue = 'blur(5px)';
              break;
            case 2:
              xPercentValue = 400;
              transformOrigin = '100% 50%';
              scaleXValue = 6;
              scaleYValue = 0.3;
              filterValue = 'blur(10px)';
              break;
            default:
              xPercentValue = 0;
              transformOrigin = '50% 50%';
              scaleXValue = 1;
              scaleYValue = 1;
              filterValue = 'blur(0px)';
          }

          gsap.fromTo(
            wrapper,
            {
              willChange: 'filter',
              xPercent: xPercentValue,
              opacity: 0,
              scaleX: scaleXValue,
              scaleY: scaleYValue,
              filter: filterValue,
            },
            {
              startAt: { transformOrigin: transformOrigin },
              scrollTrigger: {
                trigger: item,
                start: 'clamp(top bottom)',
                end: 'clamp(bottom top)',
                scrub: true,
              },
              xPercent: 0,
              opacity: 1,
              scaleX: 1,
              scaleY: 1,
              filter: 'blur(0px)',
            }
          );
        });
      });

      ScrollTrigger.refresh();
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section className={`overflow-hidden -mt-24 ${className}`}>
      <div
        ref={containerRef}
        className="columns mx-auto grid max-w-7xl grid-cols-3 gap-4 px-4 sm:px-6 md:gap-6 lg:gap-8 lg:px-8"
      >
        <div className="column flex flex-col gap-4 md:gap-6 lg:gap-8">
          {columns[0].map((image, index) => (
            <figure key={`col0-${index}`} className="column__item">
              <div className="column__item-imgwrap relative aspect-3/4 w-full overflow-hidden rounded-xl">
                <div
                  className="column__item-img h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${image.src})` }}
                  role="img"
                  aria-label={image.alt}
                />
                <div
                  className="pointer-events-none absolute inset-0 mix-blend-color"
                  style={{
                    background:
                      'linear-gradient(135deg, #8A5A2B 0%, #D4A155 100%)',
                  }}
                  aria-hidden="true"
                />
              </div>
            </figure>
          ))}
        </div>

        <div className="column flex flex-col gap-4 md:gap-6 lg:gap-8">
          {columns[1].map((image, index) => (
            <figure key={`col1-${index}`} className="column__item">
              <div className="column__item-imgwrap relative aspect-3/4 w-full overflow-hidden rounded-xl">
                <div
                  className="column__item-img h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${image.src})` }}
                  role="img"
                  aria-label={image.alt}
                />
                <div
                  className="pointer-events-none absolute inset-0 mix-blend-color"
                  style={{
                    background:
                      'linear-gradient(135deg, #8A5A2B 0%, #D4A155 100%)',
                  }}
                  aria-hidden="true"
                />
              </div>
            </figure>
          ))}
        </div>

        <div className="column flex flex-col gap-4 md:gap-6 lg:gap-8">
          {columns[2].map((image, index) => (
            <figure key={`col2-${index}`} className="column__item">
              <div className="column__item-imgwrap relative aspect-3/4 w-full overflow-hidden rounded-xl">
                <div
                  className="column__item-img h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${image.src})` }}
                  role="img"
                  aria-label={image.alt}
                />
                <div
                  className="pointer-events-none absolute inset-0 mix-blend-color"
                  style={{
                    background:
                      'linear-gradient(135deg, #8A5A2B 0%, #D4A155 100%)',
                  }}
                  aria-hidden="true"
                />
              </div>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
