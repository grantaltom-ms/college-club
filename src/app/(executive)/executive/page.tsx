import type { Metadata } from "next";
import { ExecutivePage } from "@/components/ExecutivePage";

export const metadata: Metadata = { title: "CCS: three things to watch" };

export default function Executive() {
  return <ExecutivePage />;
}
