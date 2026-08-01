export type BlogCategory =
  | "Interface Design"
  | "Product Strategy"
  | "No-Code Systems"
  | "Brand Systems"
  | "Interaction Design"
  | "Web Engineering"

export type BlogPost = {
  id: string
  category: BlogCategory
  title: string
  readTime: string
  cover: string
  coverAlt: string
}

const COVER = {
  productStudio:
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=960&h=640&q=82",
  launchRoom:
    "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=960&h=640&q=82",
  noCodeDesk:
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=960&h=640&q=82",
  brandWall:
    "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=960&h=640&q=82",
  motionReview:
    "https://images.unsplash.com/photo-1522542550221-31fd19575a2d?auto=format&fit=crop&w=960&h=640&q=82",
  buildConsole:
    "https://images.unsplash.com/photo-1559028006-448665bd7c7f?auto=format&fit=crop&w=960&h=640&q=82",
} as const

export const BLOG_POSTS: BlogPost[] = [
  {
    id: "trusted-interfaces",
    category: "Interface Design",
    title: "Interfaces That Earn Trust",
    readTime: "6 min read",
    cover: COVER.productStudio,
    coverAlt: "Modern product studio with large displays and shared desks",
  },
  {
    id: "launch-plans",
    category: "Product Strategy",
    title: "Launch Plans Without Drift",
    readTime: "5 min read",
    cover: COVER.launchRoom,
    coverAlt: "Team collaborating around laptops in a bright meeting room",
  },
  {
    id: "no-code-systems",
    category: "No-Code Systems",
    title: "No-Code Systems That Scale",
    readTime: "8 min read",
    cover: COVER.noCodeDesk,
    coverAlt: "Laptop on a desk showing a clean digital workspace",
  },
  {
    id: "product-story",
    category: "Brand Systems",
    title: "Sharper Product Storytelling",
    readTime: "7 min read",
    cover: COVER.brandWall,
    coverAlt: "Team reviewing product and brand notes on a glass wall",
  },
  {
    id: "guided-motion",
    category: "Interaction Design",
    title: "Motion That Guides the Eye",
    readTime: "4 min read",
    cover: COVER.motionReview,
    coverAlt: "Designer reviewing a colorful interface on a tablet",
  },
  {
    id: "lasting-web-builds",
    category: "Web Engineering",
    title: "Web Builds With Staying Power",
    readTime: "6 min read",
    cover: COVER.buildConsole,
    coverAlt: "Developer workspace with code and product tools on screen",
  },
]