import { useRef, useEffect, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function FocusTrap({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Capture before child autoFocus/ref callbacks can move focus on commit.
  const previousFocusRef = useRef<Element | null>(document.activeElement);
  const cachedElementsRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    cachedElementsRef.current = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (cachedElementsRef.current.length > 0) {
      cachedElementsRef.current[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      // Refresh cached list on each Tab to include dynamically added content
      cachedElementsRef.current = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      const elements = cachedElementsRef.current;
      if (elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Modal bubble handlers stop propagation before document is reached.
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  return <div ref={containerRef} style={{ display: "contents" }} onKeyDown={(e) => {
    // Keep application shortcuts out without cancelling native field editing.
    e.stopPropagation();
    if (e.key === "Escape" && onEscape) {
      e.preventDefault();
      onEscape();
    }
  }}>{children}</div>;
}
