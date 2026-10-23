export type ClubErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "refused"
  // Member check-in: too early, already done, or too late. Each has its own plain-language notice.
  | "not_open"
  | "already_recorded"
  | "too_late";

/** A refusal the person can understand. The message is plain language, safe to show as is. */
export class ClubError extends Error {
  constructor(
    public code: ClubErrorCode,
    message: string,
  ) {
    super(message);
  }
}
