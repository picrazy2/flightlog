import { useEffect, useState } from "react";

// True on narrow (phone) viewports. Drives the mobile shell + drawer system.
export function useIsMobile(breakpoint = 768): boolean {
  const [mobile, setMobile] = useState(() => (typeof window === "undefined" ? false : window.innerWidth < breakpoint));
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [breakpoint]);
  return mobile;
}
