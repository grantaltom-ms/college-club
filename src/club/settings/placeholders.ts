import attendance from "./attendance-rules.json";
import billing from "./billing-rules.json";
import booking from "./booking-rules.json";
import classes from "./class-rules.json";
import damage from "./damage-rules.json";
import events from "./event-rules.json";
import incidents from "./incident-rules.json";
import login from "./login-rules.json";
import practices from "./practice-rules.json";
import resignations from "./resignation-rules.json";
import snacks from "./snack-rules.json";
import tours from "./tour-rules.json";
import today from "./today-rules.json";

/**
 * Every rules file in this folder, with whether its numbers are still marked as placeholders. The switch-on checklist reads this to say
 * which files staff and the bookkeeper have not yet confirmed. A test holds this list to the folder, so a new rules file cannot be left
 * out of it, and holds each file's flag to the same reading the file's own parser uses (anything but an explicit `false` is a placeholder).
 */
const read = (file: string, data: { placeholder?: unknown }) => ({ file, placeholder: data.placeholder !== false });

export const RULES_FILES: { file: string; placeholder: boolean }[] = [
  read("attendance-rules.json", attendance),
  read("billing-rules.json", billing),
  read("booking-rules.json", booking),
  read("class-rules.json", classes),
  read("damage-rules.json", damage),
  read("event-rules.json", events),
  read("incident-rules.json", incidents),
  read("login-rules.json", login),
  read("practice-rules.json", practices),
  read("resignation-rules.json", resignations),
  read("snack-rules.json", snacks),
  read("today-rules.json", today),
  read("tour-rules.json", tours),
];

/** The files whose numbers are still placeholders, by file name. */
export const placeholderRulesFiles = (files: { file: string; placeholder: boolean }[] = RULES_FILES): string[] => files.filter((f) => f.placeholder).map((f) => f.file);
