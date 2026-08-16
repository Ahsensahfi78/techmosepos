"use client";

import { useStock } from "@/hooks/useStock";
import Header from "./Header";

export default function LiveHeader() {
  const { connected, lastEvent } = useStock();
  return <Header connected={connected} lastEvent={lastEvent} />;
}
