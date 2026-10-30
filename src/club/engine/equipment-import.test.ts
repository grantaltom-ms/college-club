import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import {
  EQUIPMENT_COLUMNS,
  EQUIPMENT_TEMPLATE,
  MAX_EQUIPMENT_BYTES,
  MAX_EQUIPMENT_ROWS,
  planEquipment,
  readEquipment,
  runEquipment,
} from "./equipment-import";
import { accessKind, activeAccess, activeOwners, boatLocked } from "./boat-access";
import { fingerprintOf } from "./import";
import { bookingLedger } from "./bookings";
import { createHousehold, endHousehold } from "./households";
import { NOW, STORE_KINDS, at, bookAs, fixtureFor, makeStore, memberCtx, refusedFor, staffCtx, type StoreKind } from "./testkit";
import { MemoryClubStore, sequentialIds } from "../store/memory";

const HEADER = EQUIPMENT_COLUMNS.join(",");
/** A row in the column order: Name, Type, Seats, Skill level needed, Owned by, In service, Places, Notes, Owner emails. */
const row = (name: string, type: string, seats = "", skill = "", owned = "Club", service = "", places = "", notes = "", owners = "") =>
  [name, type, seats, skill, owned, service, places, notes, owners.includes(",") || owners.includes(";") ? `"${owners}"` : owners].join(",");
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("reading an equipment file", () => {
  it("reads each row with its number as a spreadsheet shows it, skipping blank rows, and picks the boat class from the type and seats", () => {
    const reading = readEquipment(
      file(
        row("Test Single", "Shell", "1"),
        "",
        row("Test Double", "Shell", "2"),
        row("Test Quad", "shell", "4"),
        row("Test Kayak", "Kayak", "1"),
        row("Test Twin Kayak", "Kayak", "2"),
        row("Test Board", "Paddle Board"),
        row("Test Room", "Work Space"),
      ),
    );
    expect(reading.problems).toEqual([]);
    expect(reading.rowCount).toBe(7);
    expect(reading.rows.map((r) => [r.row, r.name, r.classCode, r.seats])).toEqual([
      [2, "Test Single", "shell-single", 1],
      [4, "Test Double", "shell-double", 2],
      [5, "Test Quad", "shell-quad", 4],
      [6, "Test Kayak", "kayak", 1],
      [7, "Test Twin Kayak", "kayak-double", 2],
      [8, "Test Board", "paddle-board", 1],
      [9, "Test Room", "work-space", 1],
    ]);
  });

  it("finds columns by name in any order, however they are capitalised or spelled, and ignores the sheet's Hint columns without mentioning them", () => {
    const text = ["owner, KIND ,Boat Name,Seat count,Extra column,Hint: times booked in 2026", "Club,Shell,Test Single,1,x,40"].join("\r\n");
    const reading = readEquipment(text);
    expect(reading.problems).toEqual([]);
    expect(reading.rows.map((r) => [r.name, r.type, r.seats, r.ownedBy])).toEqual([["Test Single", "Shell", 1, "club"]]);
    expect(reading.ignoredColumns).toEqual(["Extra column"]);
  });

  it("reads what a spreadsheet really writes: the invisible marker, quotation marks, any line endings", () => {
    const text = `${String.fromCharCode(0xfeff)}${HEADER}\r\n"Test ""Big"", Single",Shell,1,,Club,,,"Oars, new"\rTest Kayak,Kayak,1,,Club,No,,Paddle broken\n`;
    const reading = readEquipment(text);
    expect(reading.problems).toEqual([]);
    expect(reading.rows.map((r) => [r.name, r.notes])).toEqual([
      ['Test "Big", Single', "Oars, new"],
      ["Test Kayak", "Paddle broken"],
    ]);
    expect(reading.rows[1].inService).toBe(false);
  });

  it("says which required columns are missing, once, instead of a problem on every row", () => {
    const reading = readEquipment("Name,Type\nTest Single,Shell\nTest Kayak,Kayak\n");
    expect(reading.rows).toEqual([]);
    expect(reading.problems).toHaveLength(1);
    expect(reading.problems[0]).toContain('"Seats", "Owned by"');
    expect(reading.problems[0]).toContain("starter sheet");
  });

  it("refuses two columns that mean the same thing", () => {
    const reading = readEquipment("Name,Boat name,Type,Seats,Owned by\nTest,Test,Shell,1,Club\n");
    expect(reading.problems).toEqual(['Two columns both mean "Name": "Name" and "Boat name". Keep only one.']);
  });

  it("reports every mistake in the rows at once, each with its row number", () => {
    const long = "x".repeat(81);
    const reading = readEquipment(
      file(
        row("", "Shell", "1"), // 2: no name
        row(long, "Shell", "1"), // 3: name too long
        row("EXAMPLE-2", "Kayak", "1"), // 4: template example
        row("Test A", "Canoe", "1"), // 5: unknown type
        row("Test B", "", "1"), // 6: no type
        row("Test C", "Fitness", "1"), // 7: cardio
        row("Test D", "Shell", ""), // 8: shell with no seats
        row("Test E", "Kayak", ""), // 9: kayak with no seats
        row("Test F", "Shell", "x"), // 10: seats not a number
        row("Test G", "Shell", "3"), // 11: shell with 3 seats
        row("Test H", "Kayak", "4"), // 12: kayak with 4 seats
        row("Test I", "Paddle Board", "2"), // 13: board with 2 seats
        row("Test J", "Shell", "1", "level 9"), // 14: unknown skill
        row("Test K", "Shell", "1", "", ""), // 15: owned by empty
        row("Test L", "Shell", "1", "", "Somebody"), // 16: owned by something else
        row("Test M", "Shell", "1", "", "Club", "maybe"), // 17: in service neither
        row("Test N", "Shell", "1", "", "Club", "", "", "n".repeat(201)), // 18: notes too long
        row("Test O", "Dock Space", "", "", "", "", "0"), // 19: places 0
        row("Test P", "Gym Space", "", "", "", "", "many"), // 20: places not a number
      ),
    );
    expect(reading.rows).toEqual([]);
    expect(reading.problems).toEqual([
      "Row 2: Name is empty. Every row needs the item's name.",
      "Row 3: Name is longer than 80 characters.",
      'Row 4: "EXAMPLE-2" is one of the template\'s example rows. Delete the example rows before uploading.',
      "Row 5: Type \"Canoe\" is not one of: Shell, Kayak, Paddle Board, Work Space, Dock Space, Room Space, Gym Space.",
      "Row 6: Type is empty. Use one of: Shell, Kayak, Paddle Board, Work Space, Dock Space, Room Space, Gym Space.",
      'Row 7: Type "Fitness": cardio machines are not reserved in the new system, so remove this row.',
      "Row 8: Seats is empty. A shell needs its number of seats (1, 2 or 4).",
      "Row 9: Seats is empty. A kayak needs its number of seats (1 or 2).",
      'Row 10: Seats "x" is not a number.',
      "Row 11: Seats 3 does not fit a shell: use 1 (single), 2 (double) or 4 (quad or four).",
      "Row 12: Seats 4 does not fit a kayak: use 1 or 2.",
      "Row 13: Seats 2 does not fit a paddle board: leave it empty or use 1.",
      expect.stringContaining('Row 14: Skill level needed "level 9" is not one the system knows.'),
      "Row 15: Owned by is empty. Write Club or Private.",
      'Row 16: Owned by "Somebody" is not Club or Private.',
      'Row 17: In service "maybe" is not Yes or No.',
      "Row 18: Notes is longer than 200 characters.",
      "Row 19: Places must be a whole number from 1 to 500, or empty.",
      "Row 20: Places must be a whole number from 1 to 500, or empty.",
    ]);
  });

  it("refuses the same name twice, however it is capitalised or spaced", () => {
    const reading = readEquipment(file(row("Test  Single", "Shell", "1"), row("test single", "Shell", "1")));
    expect(reading.problems).toEqual(["Row 3: test single is already on row 2. List each item once."]);
    expect(reading.rows.map((r) => r.name)).toEqual(["Test Single"]);
  });

  it("refuses a name with a character that cannot be saved, a place count over the limit, and seats that do not fit a work space or a paddle board", () => {
    const reading = readEquipment(
      file(row("Test\u0007Bell", "Shell", "1"), row("Dock spaces", "Dock Space", "", "", "", "", "501"), row("Test Room", "Work Space", "2"), row("Test Board", "Paddle Board", "2")),
    );
    expect(reading.problems).toEqual([
      "Row 2: Name has a character that cannot be saved. Retype it.",
      "Row 3: Places must be a whole number from 1 to 500, or empty.",
      "Row 4: Seats 2 does not fit a work space: leave it empty or use 1.",
      "Row 5: Seats 2 does not fit a paddle board: leave it empty or use 1.",
    ]);
    // Exactly at the limit is fine.
    expect(readEquipment(file(row("Dock spaces", "Dock Space", "", "", "", "", "500"))).rows[0].places).toBe(500);
  });

  it("reads a skill level as a qualification's code or name, None for anyone, or empty for the class's usual", () => {
    const skills = readEquipment(
      file(row("A", "Shell", "1", "scull-2"), row("B", "Shell", "1", "Sculling level 3 (placeholder)"), row("C", "Shell", "1", "SWEEP"), row("D", "Shell", "1", "None"), row("E", "Shell", "1", "anyone"), row("F", "Shell", "1", "")),
    ).rows.map((r) => r.skill);
    expect(skills).toEqual([{ mode: "code", code: "scull-2" }, { mode: "code", code: "scull-3" }, { mode: "code", code: "sweep" }, { mode: "none" }, { mode: "none" }, { mode: "class" }]);
  });

  it("describes pools and private boats without needing seats or an owner for the pools", () => {
    const reading = readEquipment(file(row("Dock spaces", "Dock Space", "", "", "", "", "60"), row("Club spaces", "Room Space", "", "", "Club", "", ""), row("Test Private", "Shell", "1", "", "Private")));
    expect(reading.problems).toEqual([]);
    expect(reading.rows.map((r) => [r.name, r.pool, r.places, r.ownedBy])).toEqual([
      ["Dock spaces", true, 60, null],
      ["Club spaces", true, null, null],
      ["Test Private", false, null, "private"],
    ]);
  });

  it("notes when the sheet's own hint says a boat looks private", () => {
    const text = ["Name,Type,Seats,Owned by,Hint: name looks like a private boat", "A,Shell,1,Club,Yes", "B,Shell,1,Club,No"].join("\n");
    expect(readEquipment(text).rows.map((r) => r.hintedPrivate)).toEqual([true, false]);
  });

  it("refuses a file that is not a CSV, is empty, or is too big", () => {
    expect(readEquipment("PK\u0003\u0004rest").problems[0]).toContain("Excel file");
    expect(readEquipment("Name\u0000Type").problems[0]).toContain("not a plain CSV");
    expect(readEquipment("").problems).toEqual(["The file is empty."]);
    expect(readEquipment("x".repeat(MAX_EQUIPMENT_BYTES + 1)).problems[0]).toContain("too big");
    expect(readEquipment('Name,Type,Seats,Owned by\n"unclosed,Shell,1,Club\n').problems[0]).toContain("quotation mark");
  });

  it("allows exactly the row limit and refuses one more", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`Boat ${i}`, "Paddle Board"));
    expect(readEquipment(file(...rows(MAX_EQUIPMENT_ROWS))).problems).toEqual([]);
    expect(readEquipment(file(...rows(MAX_EQUIPMENT_ROWS + 1))).problems).toEqual([`The file has ${MAX_EQUIPMENT_ROWS + 1} rows. It can have up to ${MAX_EQUIPMENT_ROWS}.`]);
  });

  describe("the Owner emails column", () => {
    it("reads each owner from a semicolon list, trimmed, once however it is written, for Private rows", () => {
      const reading = readEquipment(file(row("Test Private", "Shell", "1", "", "Private", "", "", "", " Ada@Example.com ;  Ben Quill;; ada@example.com;BEN  quill ")));
      expect(reading.problems).toEqual([]);
      expect(reading.rows[0].owners).toEqual(["Ada@Example.com", "Ben Quill"]);
    });

    it("finds the column under its other names, in any place, and reads a file without it as having no owners", () => {
      const text = ["Owners,Name,Type,Seats,Owned by", "Ada Quill,Test Private,Shell,1,Private"].join("\n");
      expect(readEquipment(text).rows[0].owners).toEqual(["Ada Quill"]);
      expect(readEquipment(file(row("Test Private", "Shell", "1", "", "Private"))).rows[0].owners).toEqual([]);
      expect(readEquipment(["Name,Type,Seats,Owned by", "Test Private,Shell,1,Private"].join("\n")).rows[0].owners).toEqual([]);
    });

    it("refuses owners on a club boat, too many owners, and an owner that cannot be real", () => {
      const reading = readEquipment(
        file(
          row("Test Club", "Shell", "1", "", "Club", "", "", "", "ada@example.com"),
          row("Test Crowd", "Shell", "1", "", "Private", "", "", "", Array.from({ length: 11 }, (_, i) => `person${i}@example.com`).join(";")),
          row("Test Long", "Shell", "1", "", "Private", "", "", "", "x".repeat(121)),
        ),
      );
      expect(reading.problems).toEqual([
        "Row 2: Owner emails is only for Private boats. Clear it, or change Owned by to Private.",
        "Row 3: Owner emails lists 11 people. A boat can have up to 10 owners here; add the rest on the Private boats screen.",
        'Row 4: An owner "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..." is not an email address or a name. Write each owner as an email address or a full name, separated by semicolons.',
      ]);
    });

    it("accepts exactly ten owners", () => {
      const ten = Array.from({ length: 10 }, (_, i) => `person${i}@example.com`).join(";");
      expect(readEquipment(file(row("Test Crowd", "Shell", "1", "", "Private", "", "", "", ten))).problems).toEqual([]);
    });
  });

  it("has a template whose only problems are its own example rows", () => {
    const reading = readEquipment(EQUIPMENT_TEMPLATE);
    expect(reading.problems).toHaveLength(4);
    expect(reading.problems.every((p) => p.includes("example rows"))).toBe(true);
    expect(EQUIPMENT_TEMPLATE.split("\r\n")[0]).toBe(HEADER);
  });
});

describe("planning an equipment upload", () => {
  const emptyState = async () => (await new MemoryClubStore(sequentialIds()).read());

  it("says what each item would be, in words, and changes nothing however often it is run", async () => {
    const store = new MemoryClubStore(sequentialIds());
    const text = file(
      row("Test Single", "Shell", "1"),
      row("Test Double", "Shell", "2", "None"),
      row("Test Twin Kayak", "Kayak", "2", "", "Club", "No", "", "Paddle needs mending"),
      row("Test Falcon", "Shell", "1", "scull-3"),
      row("Test Room", "Work Space"),
    );
    const before = JSON.stringify(await store.read());
    const first = planEquipment(await store.read(), text);
    const second = planEquipment(await store.read(), text);
    expect(second).toEqual(first);
    expect(JSON.stringify(await store.read())).toBe(before);
    expect(first.problems).toEqual([]);
    expect(first.toAdd.map((i) => [i.name, i.className, i.seats, i.skill, i.outOfService, i.reason])).toEqual([
      ["Test Single", "Single", 1, "the usual level for this class (Sculling level 1 (placeholder))", false, ""],
      ["Test Double", "Double", 2, "none needed", false, ""],
      ["Test Twin Kayak", "Double kayak", 2, "none needed", true, "Paddle needs mending"],
      ["Test Falcon", "Single", 1, "Sculling level 3 (placeholder)", false, ""],
      ["Test Room", "Work space", 1, "none needed", false, ""],
    ]);
    expect(first.fingerprint).toBe(fingerprintOf(text));
    expect(first.notices).toContain("1 item will be added out of service. Staff can return it to service on the Equipment page.");
  });

  it("gives an out-of-service item without notes a plain reason", async () => {
    const plan = planEquipment(await emptyState(), file(row("Test Single", "Shell", "1", "", "Club", "No")));
    expect(plan.toAdd[0].reason).toBe("Not in service when the equipment list was loaded.");
  });

  it("adds a private boat, with no owner it starts locked and says so, and leaves the pools out and says why", async () => {
    const plan = planEquipment(await emptyState(), file(row("Test Single", "Shell", "1"), row("Test Private", "Shell", "1", "", "Private"), row("Dock spaces", "Dock Space", "", "", "Club", "", "60")));
    expect(plan.problems).toEqual([]);
    expect(plan.toAdd.map((i) => [i.name, i.private, i.owners])).toEqual([
      ["Test Single", false, []],
      ["Test Private", true, []],
    ]);
    expect(plan.toAdd[1].skill).toBe("not checked on a private boat");
    expect(plan.pools).toEqual([{ row: 4, name: "Dock spaces", type: "Dock Space", places: 60 }]);
    expect(plan.notices).toContain("1 private boat will be added. Only a private boat's owners and the people they invite can see or book it, and its skill level is not checked.");
    expect(plan.notices.join(" ")).toContain("1 private boat has no owner in the file (Test Private), so it will start locked: nobody can book it until staff add an owner on the Private boats screen.");
    expect(plan.notices.join(" ")).toContain("Pools are a later step");
  });

  it("warns when a boat marked Club looks private in the sheet's hint column", async () => {
    const text = ["Name,Type,Seats,Owned by,Hint: name looks like a private boat", "Test A,Shell,1,Club,Yes", "Test B,Shell,1,Private,Yes", "Test C,Shell,1,Club,No"].join("\n");
    const plan = planEquipment(await emptyState(), text);
    const notice = plan.notices.find((n) => n.includes("looks like a private boat"));
    expect(notice).toContain("1 row marked Club has a name that looks like a private boat");
    expect(notice).toContain("row 2");
    expect(notice).not.toContain("row 3");
  });

  it("mentions columns it does not use, but not the Hint columns", async () => {
    const plan = planEquipment(await emptyState(), ["Name,Type,Seats,Owned by,Colour,Hint: x", "Test A,Shell,1,Club,red,1"].join("\n"));
    expect(plan.ignoredColumns).toEqual(["Colour"]);
    expect(plan.notices[0]).toContain('"Colour"');
  });

  it("includes the file's own mistakes, in the order a spreadsheet shows them", async () => {
    const plan = planEquipment(await emptyState(), file(row("Test A", "Shell", "3"), row("Test B", "Shell", "1"), row("Test C", "Kayak", "")));
    expect(plan.problems.map((p) => p.slice(0, 6))).toEqual(["Row 2:", "Row 4:"]);
    // The good row is still described, but with problems on the page nothing can be loaded: the run refuses (see below).
    expect(plan.toAdd.map((i) => i.name)).toEqual(["Test B"]);
  });
});

for (const kind of STORE_KINDS) {
  describe(`loading equipment on the ${kind} store`, () => {
    const fresh = async (k: StoreKind = kind) => makeStore(k);
    const text = file(
      row("Test Single", "Shell", "1"),
      row("Test Double", "Shell", "2", "None"),
      row("Test Falcon", "Shell", "1", "scull-3"),
      row("Test Twin Kayak", "Kayak", "2", "", "Club", "No", "", "Paddle needs mending"),
      row("Test Board", "Paddle Board"),
      row("Test Room", "Work Space"),
      row("Test Private", "Shell", "1", "", "Private"),
      row("Dock spaces", "Dock Space", "", "", "Club", "", "60"),
    );

    it("is staff only, and changes nothing for anyone else", async () => {
      const store = await fresh();
      const attempt = runEquipment(store, memberCtx("00000000-0000-4000-8000-000000000001"), text);
      await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
      expect((await store.read()).items).toEqual([]);
    });

    it("adds exactly what was previewed, with each skill setting, the private boat and the out-of-service period, and leaves the pools out", async () => {
      const store = await fresh();
      const plan = planEquipment(await store.read(), text);
      const result = await runEquipment(store, staffCtx(), text, { fingerprint: plan.fingerprint, items: plan.toAdd.length });
      expect(result).toEqual({ added: 7, outOfService: 1, alreadyHere: 0, pools: 1, privateBoats: 1, locked: 1 });
      const state = await store.read();
      expect(state.items.map((i) => [i.name, i.classCode, i.requiredQualification])).toEqual([
        ["Test Single", "shell-single", undefined],
        ["Test Double", "shell-double", null],
        ["Test Falcon", "shell-single", "scull-3"],
        ["Test Twin Kayak", "kayak-double", undefined],
        ["Test Board", "paddle-board", undefined],
        ["Test Room", "work-space", undefined],
        ["Test Private", "shell-single", undefined],
      ]);
      expect(state.items.filter((i) => i.isPrivate).map((i) => i.name)).toEqual(["Test Private"]);
      expect(state.boatAccess).toEqual([]);
      expect(state.items.every((i) => Object.keys(i.ruleOverrides).length === 0)).toBe(true);
      const twin = state.items.find((i) => i.name === "Test Twin Kayak")!;
      expect(state.outOfService).toHaveLength(1);
      expect(state.outOfService[0]).toMatchObject({ itemId: twin.id, reason: "Paddle needs mending", until: null, expectedReturn: null, createdBy: { kind: "staff", label: "Test staff" } });
      expect(state.outOfService[0].from).toBe(NOW.toISOString());
    });

    it("adds nothing for a file with a problem, or when it is not the file that was checked, or when nothing is new", async () => {
      const store = await fresh();
      const broken = file(row("Test Single", "Shell", "1"), row("Test Bad", "Shell", "3"));
      await expect(runEquipment(store, staffCtx(), broken)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("1 problem, so nothing was added") });
      const plan = planEquipment(await store.read(), text);
      await expect(runEquipment(store, staffCtx(), text, { fingerprint: "0".repeat(64), items: plan.toAdd.length })).rejects.toMatchObject({ code: "conflict" });
      await expect(runEquipment(store, staffCtx(), text, { fingerprint: plan.fingerprint, items: plan.toAdd.length + 1 })).rejects.toMatchObject({ code: "conflict" });
      expect((await store.read()).items).toEqual([]);
      await runEquipment(store, staffCtx(), text, { fingerprint: plan.fingerprint, items: plan.toAdd.length });
      await expect(runEquipment(store, staffCtx(), text)).rejects.toMatchObject({ code: "conflict", message: "Everything in the file is already here or waiting for a later step, so there is nothing to add." });
      await expect(runEquipment(store, staffCtx(), file())).rejects.toMatchObject({ code: "conflict", message: "The file has no equipment to add." });
    });

    it("on a second upload adds only the new items and never changes one that is already here", async () => {
      const store = await fresh();
      await runEquipment(store, staffCtx(), file(row("Test Single", "Shell", "1"), row("Test Kayak", "Kayak", "1")));
      const before = (await store.read()).items.find((i) => i.name === "Test Single")!;
      // The new file now says the single is a double, a different skill level, and out of service: none of it is applied.
      const second = file(row("test  single", "Shell", "2", "scull-3", "Club", "No", "", "changed"), row("Test Board", "Paddle Board"));
      const plan = planEquipment(await store.read(), second);
      expect(plan.alreadyHere).toEqual([{ row: 2, name: "test single" }]);
      expect(plan.notices).toContain("1 item already in the club is left alone: an upload never changes or removes anything that is already here.");
      expect(plan.toAdd.map((i) => i.name)).toEqual(["Test Board"]);
      const result = await runEquipment(store, staffCtx(), second, { fingerprint: plan.fingerprint, items: 1 });
      expect(result).toMatchObject({ added: 1, alreadyHere: 1, outOfService: 0 });
      const state = await store.read();
      expect(state.items.map((i) => i.name)).toEqual(["Test Single", "Test Kayak", "Test Board"]);
      expect(state.items.find((i) => i.name === "Test Single")).toEqual(before);
      expect(state.outOfService).toEqual([]);
    });

    it("adds the items once however many people press confirm at once", async () => {
      const store = await fresh();
      const plan = planEquipment(await store.read(), text);
      const expectation = { fingerprint: plan.fingerprint, items: plan.toAdd.length };
      const results = await Promise.allSettled([runEquipment(store, staffCtx(), text, expectation), runEquipment(store, staffCtx(), text, expectation), runEquipment(store, staffCtx(), text, expectation)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(r.reason).toBeInstanceOf(ClubError);
      const state = await store.read();
      expect(state.items).toHaveLength(7);
      expect(state.outOfService).toHaveLength(1);
    });

    it("loads 300 items in one go, and works again and again", async () => {
      const store = await fresh();
      const batch = (n: number) => file(...Array.from({ length: 300 }, (_, i) => row(`Round ${n} boat ${i}`, i % 2 ? "Kayak" : "Shell", i % 3 === 0 ? "2" : "1")));
      for (let n = 1; n <= 3; n++) {
        const t = batch(n);
        const plan = planEquipment(await store.read(), t);
        expect(plan.problems).toEqual([]);
        await runEquipment(store, staffCtx(), t, { fingerprint: plan.fingerprint, items: plan.toAdd.length });
      }
      expect((await store.read()).items).toHaveLength(900);
    });

    it("gives items that behave: the usual level, no level, a named level, and out of service refuse or allow bookings accordingly", async () => {
      const f = await fixtureFor(kind)();
      const sheet = file(
        row("Test Single", "Shell", "1"), // the class's usual level: scull-1
        row("Test Anyone", "Shell", "1", "None"),
        row("Test Falcon", "Shell", "1", "scull-3"),
        row("Test Sparrow", "Shell", "1", "", "Club", "No", "", "Rigger loose"),
      );
      await runEquipment(f.store, staffCtx(), sheet);
      const names = new Map((await f.store.read()).items.map((i) => [i.name, i.id]));
      for (const [name, id] of names) f.i[name] = id;
      // Cy has no qualification at all; Dee has level 1; Ada has level 3. Each member books one shell a day (a house rule), so each case is its own day.
      expect(await refusedFor(bookAs(f, "Cy", "Test Single", at(1, 7), at(1, 8)))).toEqual(["not_qualified"]);
      expect(await refusedFor(bookAs(f, "Dee", "Test Single", at(1, 7), at(1, 8)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Cy", "Test Anyone", at(1, 9), at(1, 10)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Dee", "Test Falcon", at(2, 11), at(2, 12)))).toEqual(["not_qualified"]);
      expect(await refusedFor(bookAs(f, "Ada", "Test Falcon", at(2, 11), at(2, 12)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Test Sparrow", at(3, 13), at(3, 14)))).toEqual(["out_of_service"]);
    });

    it("gives a double kayak two seats, so a second person can be booked aboard", async () => {
      const f = await fixtureFor(kind)();
      await runEquipment(f.store, staffCtx(), file(row("Test Twin Kayak", "Kayak", "2"), row("Test Solo Kayak", "Kayak", "1")));
      for (const i of (await f.store.read()).items) f.i[i.name] = i.id;
      expect(await refusedFor(bookAs(f, "Ada", "Test Twin Kayak", at(1, 7), at(1, 8), ["Ben"]))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ada", "Test Solo Kayak", at(2, 9), at(2, 10), ["Ben"]))).toEqual(["too_many_crew"]);
    });
  });
}

for (const kind of STORE_KINDS) {
  describe(`private boats in an equipment upload on the ${kind} store`, () => {
    it("finds each owner by email address or full name among active members, and adds the boat private with its owners", async () => {
      const f = await fixtureFor(kind)();
      const text = file(
        row("Test Single", "Shell", "1"),
        row("Kestrel", "Shell", "1", "", "Private", "", "", "", "ada@example.com; Dee Reed"),
        row("Starling", "Shell", "2", "", "Private", "No", "", "In the shed", "ben@example.com"),
        row("Wren", "Shell", "1", "", "Private"),
      );
      const plan = planEquipment(await f.store.read(), text);
      expect(plan.problems).toEqual([]);
      expect(plan.toAdd.map((i) => [i.name, i.private, i.owners.map((o) => o.name), i.outOfService])).toEqual([
        ["Test Single", false, [], false],
        ["Kestrel", true, ["Ada Quill", "Dee Reed"], false],
        ["Starling", true, ["Ben Quill"], true],
        ["Wren", true, [], false],
      ]);
      expect(plan.notices).toContain("3 private boats will be added. Only a private boat's owners and the people they invite can see or book it, and its skill level is not checked.");
      expect(plan.notices.join(" ")).toContain("1 private boat has no owner in the file (Wren), so it will start locked");

      const result = await runEquipment(f.store, staffCtx(), text, { fingerprint: plan.fingerprint, items: plan.toAdd.length });
      expect(result).toEqual({ added: 4, outOfService: 1, alreadyHere: 0, pools: 0, privateBoats: 3, locked: 1 });
      const state = await f.store.read();
      const item = (name: string) => state.items.find((i) => i.name === name)!;
      expect(item("Test Single").isPrivate).toBeUndefined();
      expect(["Kestrel", "Starling", "Wren"].map((n) => item(n).isPrivate)).toEqual([true, true, true]);
      expect(activeAccess(state, item("Kestrel").id).map((a) => [a.memberId === f.m.Ada ? "Ada" : "Dee", a.kind, a.addedBy.label, a.addedAt])).toEqual([
        ["Ada", "owner", "Test staff", NOW.toISOString()],
        ["Dee", "owner", "Test staff", NOW.toISOString()],
      ]);
      expect(boatLocked(state, item("Wren"))).toBe(true);
      expect(boatLocked(state, item("Kestrel"))).toBe(false);
      expect(state.outOfService.map((p) => [p.itemId === item("Starling").id, p.reason])).toEqual([[true, "In the shed"]]);
    });

    it("gives an uploaded private boat the private rules: owners book it without the skill level, others cannot", async () => {
      const f = await fixtureFor(kind)();
      await runEquipment(f.store, staffCtx(), file(row("Big Private", "Shell", "4", "", "Private", "", "", "", "cy@example.com")));
      for (const i of (await f.store.read()).items) f.i[i.name] = i.id;
      // Cy holds no qualification, and a quad needs level 3 as a club boat.
      expect(await refusedFor(bookAs(f, "Cy", "Big Private", at(1, 7), at(1, 8)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ada", "Big Private", at(1, 9), at(1, 10)))).toEqual(["not_allowed_on_boat"]);
    });

    it("lists every owner it cannot find at once, with the row, and adds nothing", async () => {
      const f = await fixtureFor(kind)();
      const text = file(row("Kestrel", "Shell", "1", "", "Private", "", "", "", "ada@example.com; nobody@example.com"), row("Starling", "Shell", "1", "", "Private", "", "", "", "Nobody Atall; not an address@"), row("Third", "Shell", "1", "", "Private", "", "", "", "ben@example.com"));
      const plan = planEquipment(await f.store.read(), text);
      expect(plan.problems).toEqual([
        "Row 2: no active member has the email address nobody@example.com. Check the spelling, or leave it out and add the owner on the Private boats screen.",
        "Row 3: no active member has the name Nobody Atall. Check the spelling, or leave it out and add the owner on the Private boats screen.",
        'Row 3: "not an address@" does not look like an email address. Write each owner as an email address or a full name, separated by semicolons.',
      ]);
      await expect(runEquipment(f.store, staffCtx(), text)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("3 problems, so nothing was added") });
      expect((await f.store.read()).items.filter((i) => ["Kestrel", "Starling", "Third"].includes(i.name))).toEqual([]);
    });

    it("does not count a member who has left, and says which person a shared address or a shared name could mean", async () => {
      const f = await fixtureFor(kind)();
      await createHousehold(f.store, staffCtx(), {
        displayName: "The Moreau household",
        membershipType: "Resident",
        joinedOn: "2020-01-01",
        primary: { firstName: "Camille", lastName: "Moreau", email: "moreau@example.com" },
        additional: [{ firstName: "Julien", lastName: "Moreau", email: "moreau@example.com" }],
      });
      await createHousehold(f.store, staffCtx(), { displayName: "The Other Reed household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Dee", lastName: "Reed", email: "dee2@example.com" } });
      await endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill);
      const text = file(
        row("Shared", "Shell", "1", "", "Private", "", "", "", "moreau@example.com"),
        row("Twins", "Shell", "1", "", "Private", "", "", "", "Dee Reed"),
        row("Left", "Shell", "1", "", "Private", "", "", "", "ada@example.com"),
        row("Fine", "Shell", "1", "", "Private", "", "", "", "Julien Moreau; dee2@example.com; moreau@example.com"),
      );
      const plan = planEquipment(await f.store.read(), text);
      expect(plan.problems).toEqual([
        "Row 2: the email address moreau@example.com is shared by Camille Moreau and Julien Moreau. Write the owner's full name instead.",
        "Row 3: more than one member is called Dee Reed. Write the owner's email address instead.",
        "Row 4: no active member has the email address ada@example.com. Check the spelling, or leave it out and add the owner on the Private boats screen.",
        "Row 5: the email address moreau@example.com is shared by Camille Moreau and Julien Moreau. Write the owner's full name instead.",
      ]);
    });

    it("lists the problems in the order of the file when the reader and the owner lookup both have some", async () => {
      const f = await fixtureFor(kind)();
      const text = file(row("A", "Shell", "1", "", "Private", "", "", "", "nobody@example.com"), row("B", "Shell", "3"), row("C", "Shell", "1", "", "Private", "", "", "", "nobody2@example.com"));
      expect(planEquipment(await f.store.read(), text).problems.map((p) => p.slice(0, 6))).toEqual(["Row 2:", "Row 3:", "Row 4:"]);
    });

    it("never changes the owners of a boat already here, and counts it as already here", async () => {
      const f = await fixtureFor(kind)();
      await runEquipment(f.store, staffCtx(), file(row("Kestrel", "Shell", "1", "", "Private", "", "", "", "ada@example.com")));
      const second = file(row("kestrel", "Shell", "1", "", "Private", "", "", "", "ben@example.com"), row("Wren", "Shell", "1", "", "Private", "", "", "", "dee@example.com"));
      const plan = planEquipment(await f.store.read(), second);
      expect(plan.alreadyHere).toEqual([{ row: 2, name: "kestrel" }]);
      expect(plan.toAdd.map((i) => i.name)).toEqual(["Wren"]);
      await runEquipment(f.store, staffCtx(), second, { fingerprint: plan.fingerprint, items: 1 });
      const state = await f.store.read();
      const kestrel = state.items.find((i) => i.name === "Kestrel")!;
      expect(activeOwners(state, kestrel.id).map((m) => m.firstName)).toEqual(["Ada"]);
      expect(accessKind(state, kestrel.id, f.m.Ben)).toBeNull();
    });

    it("adds one boat's worth of lines once however many people press confirm at once", async () => {
      const f = await fixtureFor(kind)();
      const text = file(row("Kestrel", "Shell", "1", "", "Private", "", "", "", "ada@example.com;dee@example.com"));
      const plan = planEquipment(await f.store.read(), text);
      const expectation = { fingerprint: plan.fingerprint, items: plan.toAdd.length };
      const results = await Promise.allSettled([runEquipment(f.store, staffCtx(), text, expectation), runEquipment(f.store, staffCtx(), text, expectation), runEquipment(f.store, staffCtx(), text, expectation)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const state = await f.store.read();
      expect(state.items.filter((i) => i.name === "Kestrel")).toHaveLength(1);
      expect(state.boatAccess).toHaveLength(2);
    });
  });
}
