/** Animated now-playing bars, shared by the grid tile and list row. */
export function Equalizer({ className = "h-4" }: { className?: string }) {
  return (
    <span className={`flex items-end gap-0.5 ${className}`}>
      {[0.6, 1, 0.75].map((scale, i) => (
        <span
          key={i}
          className="w-0.5 origin-bottom animate-pulse bg-accent"
          style={{ height: `${scale * 100}%`, animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
