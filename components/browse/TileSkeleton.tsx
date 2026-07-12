export function TileSkeleton() {
  return (
    <div className="aspect-square animate-pulse rounded-md bg-bar">
      <div className="flex flex-col gap-1 p-2">
        <div className="h-4 w-3/4 rounded-sm bg-elem/60" />
        <div className="h-4 w-1/2 rounded-sm bg-elem/40" />
      </div>
    </div>
  );
}
