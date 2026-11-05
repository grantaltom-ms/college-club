import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { itemPage, manufacturerWords, skillKey, weightRangeWords } from "@/club/engine/equipment-edit";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { RULE_BOOK, classOf } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDay, formatMoment } from "@/club/time";
import { idParam } from "@/club/web";
import { SignedOut } from "../../SignedOut";
import { EditItemForm, ItemLifecycle } from "../ItemForms";
import { LeftInPlace } from "../LeftInPlace";
import { PageBand } from "../../PageBand";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Staff only: one item. Fix its name, skill level, seats or (for a pool) places; retire it, after reading what would stay in place;
 * or bring a retired one back. Everything done to it is a line in its file, below.
 */
export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const itemId = idParam((await params).itemId);
  const now = clubNow();
  const state = await (await getClubStore()).read();
  const item = itemId ? state.items.find((i) => i.id === itemId) : undefined;
  if (!item) notFound();

  const page = itemPage(state, RULE_BOOK, now, item.id);
  const { line, effects, file } = page;
  const retired = line.status === "retired";
  const cls = classOf(RULE_BOOK, item);

  // The sizes this kind of item comes in, and the skill levels it can ask for. A retired item can only be renamed.
  const sizes = RULE_BOOK.classes.filter((c) => c.type === cls.type);
  const seats = !retired && sizes.length > 1 ? { current: cls.seats, choices: sizes.map((c) => ({ value: c.seats, label: `${c.name} (${plural(c.seats, "seat")})` })) } : null;
  const usual = cls.requiredQualification ? (state.qualifications.find((q) => q.code === cls.requiredQualification)?.name ?? cls.requiredQualification) : "none needed";
  const skill = retired
    ? null
    : {
        current: skillKey(item),
        choices: [
          { value: "class", label: `The usual for this kind of boat (${usual})` },
          { value: "none", label: "None needed" },
          ...state.qualifications.map((q) => ({ value: q.code, label: q.name })),
        ],
      };
  const places = !retired && line.pool ? line.places : null;
  const weightEditable = !retired && (cls.type === "Shell" || cls.type === "Kayak" || cls.type === "Paddle Board");

  return (
    <section>
      <PageBand eyebrow="Boats and spaces" title={line.name} titleTag={[retired ? "Retired" : "", line.isPrivate ? "Private" : "", line.pool ? "Pool" : ""].filter(Boolean)} />
      <p>
        <Link href="/club/equipment">Back to equipment</Link>
      </p>

      <article className="club-card" data-testid="item-summary" data-status={line.status}>
        <p>
          {line.type} &middot; {line.className}
          {line.pool ? ` · ${plural(line.places, "place")}, counted rather than numbered` : ` · ${plural(line.seats, "seat")}`}
        </p>
        <p data-testid="item-skill">Skill level needed: {line.isPrivate ? "not checked on a private boat" : cls.coachesOnly ? "not checked on a coaches-only boat" : line.skill}</p>
        {(cls.type === "Shell" || cls.type === "Kayak" || cls.type === "Paddle Board") && (
          <>
            <p data-testid="item-weight">Weight class: {weightRangeWords(line.minWeightLbs, line.maxWeightLbs)}</p>
            <p data-testid="item-manufacturer">Manufacturer: {manufacturerWords(line.manufacturer)}</p>
          </>
        )}
        <p data-testid="item-status">
          {retired
            ? `Retired ${line.retired ? formatMoment(line.retired.at) : ""} by ${line.retired?.by}: ${line.retired?.reason}`
            : line.out
              ? `Out of service: ${line.out.reason}${line.out.expectedReturn ? `, expected back ${formatDay(line.out.expectedReturn)}` : ""}`
              : "In service"}
        </p>
      </article>

      <h2>{retired ? "Rename" : "Fix its details"}</h2>
      {retired && <p className="club-meta">A retired item can only be renamed. Bring it back to change anything else. Renaming it frees the name for a new item.</p>}
      {line.isPrivate && !retired && (
        <p className="club-meta">Whether a boat is private cannot be changed. If it was loaded the wrong way, retire it and add it again under another name.</p>
      )}
      <EditItemForm
        itemId={item.id}
        name={item.name}
        seats={seats}
        skill={skill}
        places={places}
        weight={
          weightEditable
            ? {
                minWeightLbs: item.minWeightLbs ?? null,
                maxWeightLbs: item.maxWeightLbs ?? null,
                manufacturer: item.manufacturer ?? null,
              }
            : undefined
        }
      />

      {retired ? (
        <>
          <h2>Bring it back</h2>
          <p>It will be offered and bookable again straight away.</p>
        </>
      ) : (
        <>
          <h2>Retire it</h2>
          <p>Use this when the club no longer has it. It disappears from every list and cannot be booked; it stays in the records, and you can bring it back.</p>
        </>
      )}
      <ItemLifecycle itemId={item.id} itemName={item.name} retired={retired}>
        <LeftInPlace effects={effects} heading={retired ? "Still booked, scheduled or reserved" : "What would be left in place"} />
      </ItemLifecycle>

      <h2>Its file</h2>
      {file.length === 0 ? (
        <p className="club-meta" data-testid="item-file-empty">
          Nothing has been changed on it yet.
        </p>
      ) : (
        <ul className="club-list" data-testid="item-file">
          {file.map((l) => (
            <li key={l.id} data-testid="item-file-line" data-kind={l.kind}>
              <span className="club-meta">{formatMoment(l.at)}</span> {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
