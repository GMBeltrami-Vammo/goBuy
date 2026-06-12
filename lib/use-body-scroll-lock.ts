import { useEffect } from "react";

/** Locks <body> scroll while a modal/drawer is mounted, restoring it on unmount. */
export function useBodyScrollLock(): void {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
}
