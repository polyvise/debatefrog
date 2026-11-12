export function JudgeThoughtBubble({ className = "" }: { className?: string }) {
  return (
    <div className={`judge-thought-bubble ${className}`} role="status">
      Weighing both sides…
    </div>
  );
}
