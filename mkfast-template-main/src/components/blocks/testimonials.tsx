import {
  home_testimonials_items_item_1_name,
  home_testimonials_items_item_1_quote,
  home_testimonials_items_item_1_role,
  home_testimonials_items_item_2_name,
  home_testimonials_items_item_2_quote,
  home_testimonials_items_item_2_role,
  home_testimonials_items_item_3_name,
  home_testimonials_items_item_3_quote,
  home_testimonials_items_item_3_role,
  home_testimonials_items_item_4_name,
  home_testimonials_items_item_4_quote,
  home_testimonials_items_item_4_role,
  home_testimonials_items_item_5_name,
  home_testimonials_items_item_5_quote,
  home_testimonials_items_item_5_role,
  home_testimonials_items_item_6_name,
  home_testimonials_items_item_6_quote,
  home_testimonials_items_item_6_role,
  home_testimonials_subtitle,
  home_testimonials_title,
} from '@/locale/paraglide/messages';
import { HeaderSection } from '@/components/shared/header-section';
import { ScrollReveal } from '@/components/shared/scroll-reveal';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
type Testimonial = {
  name: string;
  role: string;
  image: string;
  quote: string;
};
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    result.push(array.slice(i, i + chunkSize));
  }
  return result;
}
export default function TestimonialsSection() {
  const testimonials: Testimonial[] = [
    {
      name: home_testimonials_items_item_1_name(),
      role: home_testimonials_items_item_1_role(),
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jane',
      quote: home_testimonials_items_item_1_quote(),
    },
    {
      name: home_testimonials_items_item_2_name(),
      role: home_testimonials_items_item_2_role(),
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=John',
      quote: home_testimonials_items_item_2_quote(),
    },
    {
      name: home_testimonials_items_item_3_name(),
      role: home_testimonials_items_item_3_role(),
      image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
      quote: home_testimonials_items_item_3_quote(),
    },
    {
      name: home_testimonials_items_item_4_name(),
      role: home_testimonials_items_item_4_role(),
      image: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Maria',
      quote: home_testimonials_items_item_4_quote(),
    },
    {
      name: home_testimonials_items_item_5_name(),
      role: home_testimonials_items_item_5_role(),
      image: 'https://api.dicebear.com/7.x/notionists/svg?seed=Sam',
      quote: home_testimonials_items_item_5_quote(),
    },
    {
      name: home_testimonials_items_item_6_name(),
      role: home_testimonials_items_item_6_role(),
      image: 'https://api.dicebear.com/7.x/open-peeps/svg?seed=Jordan',
      quote: home_testimonials_items_item_6_quote(),
    },
  ];
  const testimonialChunks = chunkArray(
    testimonials,
    Math.ceil(testimonials.length / 3)
  );
  return (
    <section id="testimonials" className="px-4 py-16 md:py-24">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal>
          <HeaderSection
            title={home_testimonials_title()}
            subtitle={home_testimonials_subtitle()}
          />
        </ScrollReveal>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 md:mt-12 lg:grid-cols-3">
          {testimonialChunks.map((chunk, chunkIndex) => (
            <ScrollReveal
              key={chunkIndex}
              delay={chunkIndex * 120}
              className="space-y-3"
            >
              {chunk.map(({ name, role, quote, image }, _index) => (
                <Card
                  key={`${name}-${role}`}
                  className="bg-transparent shadow-none transition-colors duration-200 hover:bg-accent dark:hover:bg-card"
                >
                  <CardContent className="grid grid-cols-[auto_1fr] gap-3 pt-4">
                    <Avatar className="size-9 border-2 border-primary/25">
                      <AvatarImage
                        alt={name}
                        src={image}
                        loading="lazy"
                        width={120}
                        height={120}
                      />
                      <AvatarFallback className="absolute inset-0">
                        {name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>

                    <div>
                      <h3 className="font-medium">{name}</h3>
                      <span className="text-muted-foreground block text-sm tracking-wide">
                        {role}
                      </span>
                      <blockquote className="mt-3">
                        <p className="text-muted-foreground">{quote}</p>
                      </blockquote>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
