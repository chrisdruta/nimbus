import { Suspense } from "react";
import { SearchView } from "@/components/browse/SearchView";

// useSearchParams requires a Suspense boundary at the page level.
export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
