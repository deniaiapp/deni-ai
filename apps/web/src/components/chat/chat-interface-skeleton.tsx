import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder for /chat/$id while the pane chunk and messages load.
 * Mirrors ChatInterface layout so client navigations feel instant (the
 * sidebar stays; only the pane swaps).
 */
export function ChatInterfaceSkeleton() {
  return (
    <div className="-m-4 flex min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-3xl min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="mb-3 flex min-h-7 items-center gap-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="ml-auto h-7 w-9 rounded-md" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-2">
          <div className="flex justify-end">
            <Skeleton className="h-16 w-[min(75%,20rem)] rounded-2xl rounded-br-md" />
          </div>
          <div className="flex justify-start">
            <div className="flex w-[min(90%,28rem)] flex-col gap-2">
              <Skeleton className="h-4 w-full rounded-md" />
              <Skeleton className="h-4 w-11/12 rounded-md" />
              <Skeleton className="h-4 w-4/5 rounded-md" />
              <Skeleton className="h-4 w-2/3 rounded-md" />
            </div>
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-12 w-[min(60%,16rem)] rounded-2xl rounded-br-md" />
          </div>
          <div className="flex justify-start">
            <div className="flex w-[min(85%,24rem)] flex-col gap-2">
              <Skeleton className="h-4 w-full rounded-md" />
              <Skeleton className="h-4 w-5/6 rounded-md" />
              <Skeleton className="h-4 w-1/2 rounded-md" />
            </div>
          </div>
        </div>

        <div className="mt-4 shrink-0 space-y-2">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="flex items-center gap-2 px-1">
            <Skeleton className="h-8 w-24 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="ml-auto h-8 w-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
