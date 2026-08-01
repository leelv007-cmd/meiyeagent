import { BlogIndex } from "./components/blog-index"

export function Page() {
  return (
    <div className="bg-background flex min-h-svh w-full justify-center px-6 py-8 md:py-10 lg:py-12">
      <div className="w-full max-w-7xl">
        <BlogIndex />
      </div>
    </div>
  )
}