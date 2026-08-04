import { Skeleton } from "@/components/ui/skeleton";

/**
 * What a tab switch shows while the next page is being produced.
 *
 * Before this existed, it showed the page you were leaving. Every route in
 * this group is dynamic — they all read the session cookie — and Next can
 * only prefetch a dynamic route as far as its nearest loading boundary, so
 * with none there was nothing to prefetch and nothing to render: clicking a
 * tab did visibly nothing until a full server round trip came back. The app
 * felt slow in the specific way that has no spinner attached to it.
 *
 * One file at the group level rather than eleven tailored ones. It sits
 * inside the (app) layout, so the sidebar, bottom nav and header stay put and
 * only the content area swaps — and the shape below (a title, then stacked
 * cards) is what nearly every page in this group actually is, so the real
 * content lands roughly where the placeholder was rather than shoving it
 * aside.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-5 lg:p-9">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="mt-2 h-4 w-3/5" />
          <Skeleton className="mt-4 h-2 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}
