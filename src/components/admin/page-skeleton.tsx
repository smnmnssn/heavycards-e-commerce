import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder while an admin list or detail page loads its data. */
export function AdminPageSkeleton() {
  return (
    <div className="grid gap-8" role="status" aria-label="Laddar">
      <div className="grid gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-64 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
