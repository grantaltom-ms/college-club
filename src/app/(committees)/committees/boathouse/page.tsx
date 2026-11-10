import type { Metadata } from "next";
import { CommitteePage } from "@/components/CommitteePage";

export const metadata: Metadata = { title: "CCS Boathouse Committee" };

export default function BoathouseCommitteePage() {
  return <CommitteePage slug="boathouse" />;
}
