import { describe, expect, it } from "vitest";
import { BookingRefused, cancelBooking, createBooking } from "../engine/bookings";
import { createHousehold } from "../engine/households";
import { addMembers, at, makeStore, NOW, openAnother, databaseUrls, memberCtx, staffCtx, request, bookAs, refusedFor, STORE_KINDS, fixtureFor } from "../engine/testkit";
import { ClubError } from "../errors";
import { seedSample } from "../sample/club";
import { RULE_BOOK } from "../settings/rulebook";
import { addDays, pacificDate } from "../time";
import { MemoryClubStore, sequentialIds } from "./memory";
import { PgClubStore, createClubPool, translateDatabaseError } from "./postgres";

describe("the Postgres store's safeguards (no database needed)", () => {
  it("refuses to connect to a hosted Supabase project, including the live one", () => {
    for (const url of [
      "postgresql://postgres:x@db.hgjcnuwxhemynnvsnmou.supabase.co:5432/postgres",
      "postgresql://postgres.abc:x@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
      "postgres://u:p@elsewhere.supabase.net/db",
    ]) {
      expect(() => createClubPool(url), url).toThrow("looks like a hosted Supabase project");
    }
    const pool = createClubPool("postgresql://postgres@127.0.0.1:5432/postgres");
    void pool.end();
  });

  it("turns the database's own refusals into plain sentences and leaves everything else alone", () => {
    const overlap = translateDatabaseError({ code: "23P01" });
    expect(overlap).toBeInstanceOf(ClubError);
    expect((overlap as ClubError).message).toBe("That time was just taken by someone else. Pick another.");
    expect((overlap as ClubError).code).toBe("conflict");
    for (const code of ["40001", "40P01"]) expect((translateDatabaseError({ code }) as ClubError).message).toBe("A lot of changes arrived at once. Please try again.");
    const other = new Error("boom");
    expect(translateDatabaseError(other)).toBe(other);
    const refusal = new ClubError("forbidden", "No.");
    expect(translateDatabaseError(refusal)).toBe(refusal);
  });
});

describe.skipIf(!STORE_KINDS.includes("postgres"))("the Postgres store", () => {
  const fixture = fixtureFor("postgres");

  it("holds exactly the same sample club as the in-memory store, down to the order of every list", async () => {
    const today = "2026-10-28";
    const now = NOW;
    const memory = new MemoryClubStore(sequentialIds());
    await seedSample(memory, today, now);

    const store = (await makeStore("postgres")) as PgClubStore;
    await seedSample(store.withIds(sequentialIds()), today, now);

    const [fromMemory, fromDatabase] = [await memory.read(), await store.read()];
    expect(fromDatabase.households).toEqual(fromMemory.households);
    expect(fromDatabase.members).toEqual(fromMemory.members);
    expect(fromDatabase.qualifications).toEqual(fromMemory.qualifications);
    expect(fromDatabase.memberQualifications).toEqual(fromMemory.memberQualifications);
    expect(fromDatabase.history).toEqual(fromMemory.history);
    expect(fromDatabase.items).toEqual(fromMemory.items);
    expect(fromDatabase.outOfService).toEqual(fromMemory.outOfService);
    expect(fromDatabase.bookings).toEqual(fromMemory.bookings);
    expect(fromDatabase).toEqual(fromMemory);
    // Dates stay plain dates, not moments in somebody's time zone.
    expect(fromDatabase.households[0].joinedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fromDatabase.outOfService[0].expectedReturn).toBe(addDays(today, 5));
    // And it is a real sample: 14 households, boats, bookings, one boat out of service, a crew booking.
    expect(fromDatabase.households).toHaveLength(14);
    expect(fromDatabase.bookings.some((b) => b.crew.length > 0)).toBe(true);
  });

  it("keeps who did what, including which member, through a round trip", async () => {
    const f = await fixture();
    const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
    await cancelBooking(f.store, f.book, memberCtx(f.m.Ada, "Ada Quill"), booking.id);
    const saved = (await f.store.read()).bookings[0];
    expect(saved.createdBy).toEqual({ kind: "member", memberId: f.m.Ada, label: "Ada" });
    expect(saved.cancelledBy).toEqual({ kind: "member", memberId: f.m.Ada, label: "Ada Quill" });
    const lesson = await createBooking(f.store, f.book, staffCtx(), request(f, "Cy", "Osprey", at(2, 4, 30), at(2, 5)), { override: { reason: "Lesson" } });
    const read = (await f.store.read()).bookings.find((b) => b.id === lesson.booking.id)!;
    expect(read.override).toEqual({ reason: "Lesson", actor: { kind: "staff", label: "Test staff" }, waived: expect.arrayContaining(["not_qualified", "outside_hours"]) });
    expect(read.createdBy).toEqual({ kind: "staff", label: "Test staff" });
  });

  it("keeps crew seats in order, and remembers a seat given up", async () => {
    const f = await fixture();
    const { booking } = await bookAs(f, "Ada", "Albatross", at(1, 7), at(1, 8), ["Eli"]);
    expect((await f.store.read()).bookings[0].crew).toEqual([f.m.Eli]);
    await f.store.transaction(async (s) => {
      const b = s.bookings.find((x) => x.id === booking.id)!;
      b.crew = [];
      b.removedCrew.push({ memberId: f.m.Eli, at: NOW.toISOString(), reason: "Left the club" });
    });
    const after = (await f.store.read()).bookings[0];
    expect(after.crew).toEqual([]);
    expect(after.removedCrew).toEqual([{ memberId: f.m.Eli, at: NOW.toISOString(), reason: "Left the club" }]);
  });

  describe("two app servers sharing one database cannot beat the rules by racing", () => {
    async function twoServers() {
      const f = await fixture();
      const other = openAnother(databaseUrls.get(f.store)!);
      return { f, a: f, b: { ...f, store: other } };
    }

    it("twenty members on two servers grab the same slot: exactly one booking", async () => {
      const { f, b } = await twoServers();
      const people = await addMembers(f, 20);
      const outcomes = await Promise.allSettled(people.map((id, n) => bookAs(n % 2 ? b : f, id, "Heron", at(1, 7), at(1, 8))));
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(lost).toHaveLength(19);
      for (const l of lost) expect((l.reason as BookingRefused).reasons.map((r) => r.code)).toEqual(["slot_taken"]);
      expect((await f.store.read()).bookings.filter((x) => x.status === "upcoming")).toHaveLength(1);
    }, 30_000);

    it("one member firing twenty requests at both servers cannot get past her limit of two", async () => {
      const { f, b } = await twoServers();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 20 }, (_, n) => bookAs(n % 2 ? b : f, "Ada", "Heron", at(1 + (n % 7), 5 + Math.floor(n / 7)), at(1 + (n % 7), 5 + Math.floor(n / 7), 30))),
      );
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(2);
      const reasons = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").flatMap((o) => (o.reason as BookingRefused).reasons.map((r) => r.code));
      expect(reasons).toContain("over_future_limit");
      expect((await f.store.read()).bookings.filter((x) => x.bookerId === f.m.Ada && x.status === "upcoming")).toHaveLength(2);
    }, 30_000);

    it("the same person cannot be put in two boats at once by two servers", async () => {
      const { f, b } = await twoServers();
      // Ada and Eli both want Ben as crew, in different boats, at the same time.
      const [one, two] = await Promise.allSettled([bookAs(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]), bookAs(b, "Eli", "Pelican", at(1, 7), at(1, 8), ["Ben"])]);
      expect([one.status, two.status].sort()).toEqual(["fulfilled", "rejected"]);
      const rejected = [one, two].find((o): o is PromiseRejectedResult => o.status === "rejected")!;
      expect((rejected.reason as BookingRefused).reasons.map((r) => r.code)).toEqual(["person_busy"]);
    }, 30_000);

    it("a booking and a cancellation crossing each other never lose either", async () => {
      const { f, b } = await twoServers();
      const first = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const [cancelled, rebooked] = await Promise.allSettled([
        cancelBooking(f.store, f.book, memberCtx(f.m.Ada, "Ada"), first.booking.id),
        bookAs(b, "Dee", "Heron", at(1, 7), at(1, 8)),
      ]);
      expect(cancelled.status).toBe("fulfilled");
      // Dee either arrived before the cancellation (refused: taken) or after (booked). Never an overlap, never a lost cancel.
      const state = await f.store.read();
      expect(state.bookings.find((x) => x.id === first.booking.id)?.status).toBe("cancelled");
      expect(state.bookings.filter((x) => x.status === "upcoming" && x.itemId === f.i.Heron).length).toBe(rebooked.status === "fulfilled" ? 1 : 0);
    });

    it("an ending household and a new booking by one of its adults cannot both win", async () => {
      const { f, b } = await twoServers();
      const { endHousehold } = await import("../engine/households");
      const { bookingLedger } = await import("../engine/bookings");
      const [ended, booked] = await Promise.allSettled([endHousehold(f.store, bookingLedger, staffCtx(), f.h.Quill), bookAs(b, "Ada", "Heron", at(1, 7), at(1, 8))]);
      expect(ended.status).toBe("fulfilled");
      const upcomingByQuills = (await f.store.read()).bookings.filter((x) => [f.m.Ada, f.m.Ben, f.m.Cy].includes(x.bookerId) && x.status === "upcoming");
      // Whichever came first, no Quill is left holding a booking once the household has ended.
      expect(upcomingByQuills).toHaveLength(0);
      if (booked.status === "rejected") expect((booked.reason as BookingRefused).reasons.map((r) => r.code)).toEqual(["member_blocked"]);
    });
  });

  describe("the database is still the last line of defence", () => {
    it("turns an overlap that slips past the engine into a plain refusal and keeps nothing from that change", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      const before = await f.store.read();
      // A change that (wrongly) writes an overlapping booking without asking the engine.
      const sneaky = f.store.transaction(async (s, newId) => {
        const clone = structuredClone(s.bookings[0]);
        clone.id = newId();
        clone.bookerId = f.m.Dee;
        s.bookings.push(clone);
        s.items.find((i) => i.name === "Osprey")!.ruleOverrides = { maxMinutes: 60 }; // part of the same change: must not survive
      });
      await expect(sneaky).rejects.toThrow("That time was just taken by someone else. Pick another.");
      await expect(sneaky).rejects.toMatchObject({ code: "conflict" });
      expect(await f.store.read()).toEqual(before);
    });

    it("never deletes anything, and never lets a history line be rewritten", async () => {
      const f = await fixture();
      await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
      await expect(f.store.transaction(async (s) => void s.bookings.splice(0, 1))).rejects.toThrow("never deletes bookings");
      await expect(f.store.transaction(async (s) => void s.households.splice(0, 1))).rejects.toThrow("never deletes households");
      await expect(f.store.transaction(async (s) => void (s.history[0].summary = "Rewritten."))).rejects.toThrow("can only be added to");
      expect((await f.store.read()).bookings).toHaveLength(1);
    });

    it("rolls everything back when a change fails halfway", async () => {
      const f = await fixture();
      const before = await f.store.read();
      await expect(
        f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Ghost boat", classCode: "shell-single", ruleOverrides: {} });
          throw new ClubError("conflict", "Changed my mind.");
        }),
      ).rejects.toThrow("Changed my mind.");
      expect(await f.store.read()).toEqual(before);
      // The store carries on working afterwards.
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8)))).toEqual([]);
    });
  });

  describe("reading", () => {
    it("is not held up by a change in progress, and sees only what has been committed", async () => {
      const f = await fixture();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let started!: () => void;
      const inside = new Promise<void>((resolve) => (started = resolve));
      const slowChange = f.store.transaction(async (s, newId) => {
        s.items.push({ id: newId(), name: "Slow boat", classCode: "shell-single", ruleOverrides: {} });
        started();
        await gate;
      });
      await inside;
      const during = await f.store.read(); // returns straight away, without the new boat
      expect(during.items.map((i) => i.name)).not.toContain("Slow boat");
      release();
      await slowChange;
      expect((await f.store.read()).items.map((i) => i.name)).toContain("Slow boat");
    });

    it("loads only the recent bookings it was asked to, and still books correctly alongside the old ones", async () => {
      const f = await fixture();
      const old = await bookAs(f, "Ada", "Heron", at(-20, 7), at(-20, 8), [], undefined, at(-21, 12));
      await bookAs(f, "Dee", "Osprey", at(1, 7), at(1, 8));
      const short = new PgClubStore(createClubPool(databaseUrls.get(f.store)!, 2), { historyDays: 7, now: () => NOW });
      try {
        const recent = await short.read();
        expect(recent.bookings.map((b) => b.itemId)).toEqual([f.i.Osprey]);
        expect(recent.bookings.some((b) => b.id === old.booking.id)).toBe(false);
        // Everything else is still there, and a change through the short view works and leaves the old booking alone.
        expect(recent.households).toHaveLength(2);
        await createBooking(short, f.book, memberCtx(f.m.Eli, "Eli"), request(f, "Eli", "Kingfisher", at(2, 7), at(2, 8)));
      } finally {
        await short.close();
      }
      const all = await f.store.read();
      expect(all.bookings.map((b) => b.id)).toContain(old.booking.id);
      expect(all.bookings).toHaveLength(3);
    });
  });

  describe("setting up", () => {
    it("brings the rule tables in line with the rules file, as often as asked", async () => {
      const store = (await makeStore("postgres")) as PgClubStore;
      await store.syncRules(RULE_BOOK);
      await store.syncRules(RULE_BOOK);
      const db = databaseUrls.get(store)!;
      const pool = createClubPool(db, 1);
      try {
        const classes = (await pool.query("select code, booking_type, seats, required_qualification, rules from club.item_classes order by code")).rows;
        expect(classes.map((c) => c.code)).toEqual(RULE_BOOK.classes.map((c) => c.code).sort());
        expect(classes.find((c) => c.code === "shell-quad")).toMatchObject({ booking_type: "Shell", seats: 4, required_qualification: "scull-3", rules: {} });
        expect((await pool.query("select placeholder, rules from club.booking_rule_defaults")).rows).toEqual([{ placeholder: true, rules: RULE_BOOK.defaults }]);
        await store.syncRules({ ...RULE_BOOK, defaults: { ...RULE_BOOK.defaults, windowDays: 5 } });
        expect((await pool.query("select rules from club.booking_rule_defaults")).rows[0].rules.windowDays).toBe(5);
      } finally {
        await pool.end();
      }
    });

    it("loads the sample club once, even when two servers start at the same moment, and never into a database with members in it", async () => {
      const first = (await makeStore("postgres")) as PgClubStore;
      const second = openAnother(databaseUrls.get(first)!);
      let seeded = 0;
      const seed = async (s: PgClubStore) => {
        seeded += 1;
        await seedSample(s.withIds(sequentialIds()), pacificDate(NOW), NOW);
      };
      const results = await Promise.all([first.seedIfEmpty(seed), second.seedIfEmpty(seed)]);
      expect(results.sort()).toEqual([false, true]);
      expect(seeded).toBe(1);
      expect((await first.read()).households).toHaveLength(14);

      // A database that already has a household is left strictly alone.
      const real = (await makeStore("postgres")) as PgClubStore;
      await createHousehold(real, staffCtx(), { displayName: "The Only household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "O", lastName: "Nly", email: "o@example.com" } });
      expect(await real.seedIfEmpty(seed)).toBe(false);
      expect(seeded).toBe(1);
      expect((await real.read()).households).toHaveLength(1);
    });
  });
});
