import type { Metadata } from "next";
import { CommitteePage } from "@/components/CommitteePage";

export const metadata: Metadata = { title: "CCS Membership Committee" };

export default function MembershipCommitteePage() {
  return <CommitteePage slug="membership" />;
}
