import { LoadingState, Skeleton } from "@/components/ui/loading-state";

export default function Loading() {
  return (
    <>
      <LoadingState />
      <div className="area-grid">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </>
  );
}
