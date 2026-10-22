export type ClubErrorCode = "forbidden" | "not_found" | "invalid" | "conflict";

/** A refusal the person can understand. The message is plain language, safe to show as is. */
export class ClubError extends Error {
  constructor(
    public code: ClubErrorCode,
    message: string,
  ) {
    super(message);
  }
}
