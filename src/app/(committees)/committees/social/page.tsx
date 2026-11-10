import type { Metadata } from "next";
import { CommitteePage } from "@/components/CommitteePage";

export const metadata: Metadata = { title: "CCS Social Committee" };

export default function SocialCommitteePage() {
  return <CommitteePage slug="social" />;
}
