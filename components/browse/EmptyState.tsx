import { IconCloud } from "@/components/ui/icons";

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-muted">
      <IconCloud size={48} />
      <p>{message}</p>
    </div>
  );
}
