import type { IncidentRules, IncidentRuleValues } from "../types";
import raw from "./incident-rules.json";

/** A mistake in the incident report rules file, worded so someone editing it can fix it. */
export class IncidentRulesError extends Error {}

const RULES: Record<keyof IncidentRuleValues, { label: string; min: number; max: number }> = {
  maxDaysBack: { label: "maxDaysBack (how many days back an incident can be dated)", min: 1, max: 730 },
  maxPeople: { label: "maxPeople (the most people one report can name)", min: 1, max: 100 },
  maxBoats: { label: "maxBoats (the most boats or spaces one report can name)", min: 1, max: 50 },
  whatHappenedMax: { label: "whatHappenedMax (the longest 'what happened' text)", min: 100, max: 3000 },
  locationMax: { label: "locationMax (the longest 'where' text)", min: 20, max: 400 },
  conditionsMax: { label: "conditionsMax (the longest 'water and weather' text)", min: 20, max: 600 },
  firstAidMax: { label: "firstAidMax (the longest first aid text)", min: 20, max: 600 },
  emergencyMax: { label: "emergencyMax (the longest 'emergency services' text)", min: 20, max: 400 },
  personNameMax: { label: "personNameMax (the longest name typed for someone involved)", min: 20, max: 120 },
  causeMax: { label: "causeMax (the longest 'cause' text)", min: 50, max: 2000 },
  changeMax: { label: "changeMax (the longest 'what will change' text)", min: 50, max: 2000 },
  followUpByMax: { label: "followUpByMax (the longest 'who is following up' text)", min: 10, max: 120 },
  noteMax: { label: "noteMax (the longest note on a report)", min: 50, max: 1000 },
  closingNoteMax: { label: "closingNoteMax (the longest 'what was done' text when a report is closed)", min: 50, max: 2000 },
};

/**
 * The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. Every limit
 * stays inside what the database column holds, so a text the rules allow can always be saved.
 */
export function parseIncidentRules(input: unknown): IncidentRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new IncidentRulesError("The incident report rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new IncidentRulesError('The incident report rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new IncidentRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof IncidentRuleValues];
    if (!rule) throw new IncidentRulesError(`defaults: "${key}" is not an incident report rule. The incident report rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new IncidentRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new IncidentRulesError(`defaults, ${rule.label} must be at least ${rule.min}.`);
    if (value > rule.max) throw new IncidentRulesError(`defaults, ${rule.label} cannot be more than ${rule.max}.`);
  }
  return { placeholder: data.placeholder !== false, defaults: { ...(data.defaults as unknown as IncidentRuleValues) } };
}

/** The rules incident reports run on, read and checked once. */
export const INCIDENT_RULES: IncidentRules = parseIncidentRules(raw);
