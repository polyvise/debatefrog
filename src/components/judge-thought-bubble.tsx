"use client";

import { Cog } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function JudgeThoughtBubble({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting)
    );
    if (ref.current) observer?.observe(ref.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  return (
    <div ref={ref} className={`judge-thought-bubble ${className}${inView && pageVisible ? " is-active" : ""}`} role="status">
      <span className="judge-thought-gears" aria-hidden="true">
        <Cog className="judge-thought-gear judge-thought-gear-large" strokeWidth={1.8} />
        <Cog className="judge-thought-gear judge-thought-gear-small" strokeWidth={1.8} />
      </span>
      <span>Weighing both sides…</span>
    </div>
  );
}
