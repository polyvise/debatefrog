"use client";

import { useEffect, useState } from "react";

export function RoundCountdown({
  endsAt,
  isClosingRound,
  className
}: {
  endsAt: number;
  isClosingRound: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  if (seconds === 0) return null;

  return (
    <div className={className} role="timer" aria-live="off">
      {isClosingRound ? "Judge’s turn" : "Next round"} in{" "}
      <strong className="tabular-nums">{seconds}s</strong>
    </div>
  );
}
