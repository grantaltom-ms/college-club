import { after } from "next/server";

/**
 * Runs `job` once the response to the person who pressed the button has gone out, so they never wait for an email to be handed over.
 * Outside a request (the automated tests, a script) there is no response to wait for, so the job simply runs at once.
 * A job never throws: whatever goes wrong inside is the job's own to log.
 */
export async function afterResponse(job: () => Promise<void>): Promise<void> {
  try {
    after(job);
  } catch {
    await job();
  }
}
