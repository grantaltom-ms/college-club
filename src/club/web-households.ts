import type { NewHousehold, NewMember } from "./engine/households";
import { MEMBERSHIP_TYPES, type MembershipType } from "./types";
import { field } from "./web-post";

/** The names of the add-household form's fields, in the order they come back on the address when a mistake needs fixing. */
export const HOUSEHOLD_FORM_FIELDS = ["name", "type", "joined", "firstName", "lastName", "email", "phone", "firstName2", "lastName2", "email2", "phone2"] as const;

const adult = (form: FormData, suffix: "" | "2"): NewMember => ({
  firstName: field(form, `firstName${suffix}`, 80),
  lastName: field(form, `lastName${suffix}`, 80),
  email: field(form, `email${suffix}`, 200),
  phone: field(form, `phone${suffix}`, 40),
});

const filledIn = (m: NewMember) => Boolean(m.firstName || m.lastName || m.email || m.phone);

/**
 * Reads the staff add-household form: the household, its primary adult and, if any of its boxes are filled in, a second adult.
 * Nothing is judged here; the wording of anything wrong with the values comes from the engine.
 */
export function parseHouseholdForm(form: FormData): NewHousehold {
  const type = field(form, "type") as MembershipType;
  const second = adult(form, "2");
  return {
    displayName: field(form, "name", 120),
    membershipType: (MEMBERSHIP_TYPES as readonly string[]).includes(type) ? type : ("" as MembershipType),
    joinedOn: field(form, "joined", 10),
    primary: adult(form, ""),
    additional: filledIn(second) ? [second] : [],
  };
}

/** The same, from the values on the address (the form comes back with what was typed). */
export function householdFromQuery(get: (name: string) => string): NewHousehold {
  const type = get("type") as MembershipType;
  const person = (suffix: "" | "2"): NewMember => ({ firstName: get(`firstName${suffix}`), lastName: get(`lastName${suffix}`), email: get(`email${suffix}`), phone: get(`phone${suffix}`) });
  const second = person("2");
  return {
    displayName: get("name"),
    membershipType: (MEMBERSHIP_TYPES as readonly string[]).includes(type) ? type : ("" as MembershipType),
    joinedOn: get("joined"),
    primary: person(""),
    additional: filledIn(second) ? [second] : [],
  };
}

/** Reads a single added adult. */
export function parseAdultForm(form: FormData): NewMember {
  return adult(form, "");
}
