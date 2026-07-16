import { cn } from "@/lib/utils"
import { m } from "@/locale/paraglide/messages"
import { IconLoader } from "@tabler/icons-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <IconLoader role="status" aria-label={m.common_loading()} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
