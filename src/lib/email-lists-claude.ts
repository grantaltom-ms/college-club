import Anthropic from "@anthropic-ai/sdk";
import {
  DRAFT_SCHEMA,
  draftInstructions,
  parseDraft,
  parseRule,
  ruleInstructions,
  ruleSchema,
  type DraftCopy,
  type ListRule,
  type PoolInfo,
} from "./email-lists";

/**
 * The two questions the list builder asks Claude: "which filters does this description mean?" and "write this email".
 * Claude never sees a member's name or address: it gets the description, today's date and the list of interests on file, and
 * for a draft, the list's name, its filters in words and how many households it has.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";

export class ClaudeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function claudeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

function client(): Anthropic {
  if (!claudeConfigured()) throw new ClaudeError(503, "Claude is not connected yet. Add ANTHROPIC_API_KEY in Vercel, then redeploy.");
  return new Anthropic({ maxRetries: 2, timeout: 90_000 });
}

const model = () => process.env.EMAIL_LISTS_MODEL?.trim() || DEFAULT_MODEL;

async function askForJson(system: string, user: string, schema: Record<string, unknown>): Promise<unknown> {
  let response: Anthropic.Message;
  try {
    response = await client().messages.create({
      model: model(),
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    });
  } catch (error) {
    if (error instanceof ClaudeError) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ClaudeError(502, "Claude refused the club's key. Check ANTHROPIC_API_KEY in Vercel.");
    }
    if (error instanceof Anthropic.RateLimitError) throw new ClaudeError(503, "Claude is busy right now. Wait a minute and try again.");
    console.error("Claude request failed", error instanceof Anthropic.APIError ? error.status : error);
    throw new ClaudeError(502, "Claude could not be reached. Try again in a minute.");
  }
  if (response.stop_reason === "refusal") throw new ClaudeError(422, "Claude would not answer that one. Try wording it differently.");
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new ClaudeError(502, "Claude's answer was empty. Try again.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError(502, "Claude's answer could not be read. Try again.");
  }
}

export interface RuleReading {
  rule: ListRule;
  listName: string;
  notUnderstood: string[];
}

export async function readDescription(description: string, today: string, info: PoolInfo): Promise<RuleReading> {
  const answer = (await askForJson(ruleInstructions(today, info), `Description: ${description}`, ruleSchema(info.interests))) as Record<string, unknown>;
  const parsed = parseRule(answer?.rule);
  if ("error" in parsed) throw new ClaudeError(502, `Claude's filters did not make sense (${parsed.error}). Try wording it differently.`);
  // Interests Claude made up are dropped and reported, so a filter never silently matches nobody.
  const unknown = parsed.rule.interestsAny.filter((i) => !info.interests.includes(i));
  const rule = { ...parsed.rule, interestsAny: parsed.rule.interestsAny.filter((i) => info.interests.includes(i)) };
  const notUnderstood = Array.isArray(answer.notUnderstood) ? answer.notUnderstood.filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, 10) : [];
  if (unknown.length) notUnderstood.push(`interest in ${unknown.join(", ")} (nobody has that interest on file)`);
  const listName = typeof answer.listName === "string" && answer.listName.trim() ? answer.listName.trim().slice(0, 80) : "New list";
  return { rule, listName, notUnderstood };
}

export async function writeDraft(request: string, listName: string, ruleWords: string[], count: number): Promise<DraftCopy> {
  const answer = await askForJson(draftInstructions(listName, ruleWords, count), `What the email should say: ${request}`, DRAFT_SCHEMA);
  const copy = parseDraft(answer);
  if (!copy) throw new ClaudeError(502, "Claude's draft could not be used. Try again.");
  return copy;
}
