import raw from "./login-rules.json";

/** A mistake in the login rules file, worded so someone editing it can fix it. */
export class LoginRulesError extends Error {}

export interface LoginRuleValues {
  /** A sign-in link works for this many minutes, and only once. */
  linkMinutes: number;
  /** Someone stays signed in on a device this many days. */
  sessionDays: number;
  /** One email address can ask for this many sign-in links an hour. */
  linksPerHourPerEmail: number;
}

export interface LoginRules {
  /** True while the numbers are placeholders. */
  placeholder: boolean;
  defaults: LoginRuleValues;
}

const RULES: Record<keyof LoginRuleValues, { label: string; min: number; max: number }> = {
  linkMinutes: { label: "linkMinutes (a sign-in link works for this many minutes)", min: 5, max: 60 },
  sessionDays: { label: "sessionDays (someone stays signed in on a device this many days)", min: 1, max: 90 },
  linksPerHourPerEmail: { label: "linksPerHourPerEmail (sign-in links one email address can ask for in an hour)", min: 1, max: 20 },
};

/** The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. */
export function parseLoginRules(input: unknown): LoginRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new LoginRulesError("The login rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new LoginRulesError('The login rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new LoginRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof LoginRuleValues];
    if (!rule) throw new LoginRulesError(`defaults: "${key}" is not a login rule. The login rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new LoginRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new LoginRulesError(`defaults, ${rule.label} must be at least ${rule.min}.`);
    if (value > rule.max) throw new LoginRulesError(`defaults, ${rule.label} cannot be more than ${rule.max}.`);
  }
  return { placeholder: data.placeholder !== false, defaults: { ...(data.defaults as object) } as LoginRuleValues };
}

/** The rules the sign-in screens run on, read and checked once. */
export const LOGIN_RULES: LoginRules = parseLoginRules(raw);
