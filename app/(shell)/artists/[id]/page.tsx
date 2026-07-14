"use client";

import { use } from "react";
import { ArtistView } from "@/components/browse/ArtistView";

export default function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ArtistView artistId={Number(id)} />;
}
