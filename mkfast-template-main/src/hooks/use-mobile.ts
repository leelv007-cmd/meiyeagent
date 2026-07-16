import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_LANDSCAPE_MAX_WIDTH = 960

function isMobileViewport() {
  return (
    window.innerWidth < MOBILE_BREAKPOINT ||
    (window.innerWidth < MOBILE_LANDSCAPE_MAX_WIDTH &&
      window.matchMedia("(pointer: coarse)").matches)
  )
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : isMobileViewport()
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const coarse = window.matchMedia("(pointer: coarse)")
    const onChange = () => {
      setIsMobile(isMobileViewport())
    }
    mql.addEventListener("change", onChange)
    coarse.addEventListener("change", onChange)
    setIsMobile(isMobileViewport())
    return () => {
      mql.removeEventListener("change", onChange)
      coarse.removeEventListener("change", onChange)
    }
  }, [])

  return !!isMobile
}
