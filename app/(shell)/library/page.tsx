import { BrowseView } from "@/components/browse/BrowseView";

export default function LibraryPage() {
  return <BrowseView source={{ kind: "likes" }} title="Liked Tracks" />;
}
