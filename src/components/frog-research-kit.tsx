"use client";

import { useEffect, useRef, useState } from "react";

/** Research props shared by the two frog rigs, in the theater's SVG coordinates. */
export function FrogResearchKit({
  activity,
  handColor
}: {
  activity: "search" | "notes";
  handColor: string;
}) {
  const ref = useRef<SVGGElement>(null);
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
    <g ref={ref} className={`frog-research-kit${inView && pageVisible ? " is-active" : ""}`}>
      {/* The open book rests in the frog's hands. */}
      <path d="M23 64 Q42 59 60 67 Q78 59 97 64 L97 91 Q78 86 60 94 Q42 86 23 91Z" fill="#664d39" />
      <path d="M26 62 Q43 59 60 66 L60 90 Q43 84 26 88Z" fill="#fff7dd" />
      <path d="M60 66 Q77 59 94 62 L94 88 Q77 84 60 90Z" fill="#f0e1b9" />
      <path d="M32 69 L50 72 M32 75 L50 78 M69 71 L87 68 M69 77 L87 74 M69 83 L81 81" stroke="#997e57" strokeWidth="2" strokeLinecap="round" />
      <g className="frog-research-page">
        <path d="M60 66 Q77 59 94 62 L94 88 Q77 84 60 90Z" fill="#fff7dd" stroke="#d2bc88" strokeWidth="0.8" />
        <path d="M68 71 L86 68 M68 77 L86 74 M68 83 L80 81" stroke="#997e57" strokeWidth="2" strokeLinecap="round" />
      </g>
      <ellipse cx="24" cy="79" rx="5" ry="7" fill={handColor} />
      <ellipse cx="96" cy="79" rx="5" ry="7" fill={handColor} />
      {activity === "search" ? (
        <g className="frog-research-glass">
          <path d="M48 79 L57 90" stroke="#664d39" strokeWidth="5" strokeLinecap="round" />
          <circle cx="41" cy="71" r="12" fill="#d7f0ee" fillOpacity="0.65" stroke="#253f46" strokeWidth="3.5" />
          <path d="M34 68 Q36 63 41 63" stroke="#fffdf2" strokeWidth="2" strokeLinecap="round" fill="none" />
          <ellipse cx="55" cy="87" rx="5" ry="4" fill={handColor} />
        </g>
      ) : (
        <g className="frog-research-pencil">
          <path d="M74 82 L89 58" stroke="#6c492d" strokeWidth="6" />
          <path d="M74 82 L89 58" stroke="#f4c95d" strokeWidth="4" />
          <path d="M74 82 L70 88 L72 80Z" fill="#253f46" />
          <path d="M89 58 L91 55" stroke="#e8a3b4" strokeWidth="6" />
          <ellipse cx="84" cy="72" rx="6" ry="4" fill={handColor} />
        </g>
      )}
    </g>
  );
}
