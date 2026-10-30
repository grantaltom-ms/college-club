import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ipadCode } from "../../src/club/engine/ipad-address";

// Port 3101: a production build with the sample-data switch off, like the live site by default.
// Port 3102: the switch is on by mistake, but the deployment says it is the live production site.
// In both, the member area and the "act as this test member" picker must not exist at all.
const HIDDEN = {
  "production build, sample switch off": "http://localhost:3101",
  "live production site, sample switch on": "http://localhost:3102",
};

const FIRST_HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
// Both servers are given this iPad secret on purpose: even with the right secret, the front-desk iPad must not exist here.
const IPAD_CODE = ipadCode("playwright-only-ipad-secret-0001");

for (const [name, base] of Object.entries(HIDDEN)) {
  test.describe(name, () => {
    test("the member area answers 'page not found', not a login or a picker", async () => {
      const paths = [
        "/club",
        "/club/act-as",
        `/club/household/${FIRST_HOUSEHOLD}`,
        "/club/anything-else",
        "/club/book",
        "/club/book?day=2026-10-29&type=Shell",
        `/club/book/new?item=${FIRST_HOUSEHOLD}&start=2026-10-29T14:00:00.000Z`,
        "/club/my-bookings",
        "/club/equipment",
        "/club/classes",
        "/club/classes?day=2026-10-30",
        `/club/classes/${FIRST_HOUSEHOLD}`,
        "/club/classes/manage",
        "/club/my-classes",
        "/club/events",
        "/club/events/manage",
        `/club/events/${FIRST_HOUSEHOLD}`,
        `/club/rsvp/${FIRST_HOUSEHOLD}/${FIRST_HOUSEHOLD}/${"A".repeat(43)}`,
        `/api/club/events/${FIRST_HOUSEHOLD}/links`,
        "/club/admin",
        "/club/admin?checked=1",
        "/club/admin/check-in",
        "/club/admin/check-in?q=ada",
        "/club/admin/households/new",
        `/club/admin/households/${FIRST_HOUSEHOLD}/end`,
        `/club/admin/households/${FIRST_HOUSEHOLD}/remove/${FIRST_HOUSEHOLD}`,
        `/club/admin/households/${FIRST_HOUSEHOLD}/members/${FIRST_HOUSEHOLD}/edit`,
        "/club/admin/ipad",
        "/club/admin/import",
        "/api/club/import/template",
        "/club/admin/resignations",
        "/api/club/resignations/template",
        "/club/admin/equipment-import",
        "/api/club/equipment/template",
        "/club/my-boats",
        `/club/my-boats?boat=${FIRST_HOUSEHOLD}&q=ada`,
        "/club/admin/boats",
        `/club/admin/boats?boat=${FIRST_HOUSEHOLD}&q=ada`,
        "/club/damage",
        `/club/damage?item=${FIRST_HOUSEHOLD}`,
        "/club/admin/damage",
        "/club/admin/damage?show=closed",
        `/club/admin/damage/${FIRST_HOUSEHOLD}`,
        "/club/admin/history",
        "/club/admin/history?name=pat+example",
        "/api/club/history/template",
        "/club/my-history",
        "/club/my-history?page=2",
        "/club/admin/charges",
        "/club/admin/visitors",
        "/club/admin/billing",
        "/club/admin/billing?month=2026-09",
        "/club/admin/tours",
        "/club/manifest.webmanifest",
        "/club/pwa-icon/180",
        "/club/pwa-icon/192",
        "/club/pwa-icon/512",
        "/club/pwa-icon/999",
        "/api/club/billing/2026-09/qbo/1",
        "/api/club/billing/2026-09/charges",
        `/club/ipad/${IPAD_CODE}`,
        `/club/ipad/${IPAD_CODE}/visitors`,
        `/club/ipad/${IPAD_CODE}/visitors?q=smith`,
        `/club/ipad/${IPAD_CODE}/visitors/${FIRST_HOUSEHOLD}`,
        `/club/ipad/${"A".repeat(43)}/visitors`,
        `/club/ipad/${IPAD_CODE}?notice=forbidden`,
        `/club/ipad/${IPAD_CODE}/${FIRST_HOUSEHOLD}`,
        `/club/ipad/${"A".repeat(43)}`,
        "/club/sign-in",
        "/club/sign-in?sent=1",
        "/club/sign-in?out=1",
        "/club/sign-in?notice=signin_link",
        `/club/sign-in/${"A".repeat(43)}`,
        "/club/outbox",
      ];
      for (const path of paths) {
        const res = await fetch(`${base}${path}`);
        expect(res.status, path).toBe(404);
        const html = await res.text();
        expect(html, path).not.toMatch(/Act as|Test staff|Switch test member|Lindqvist|Abernathy|test build|invented|ccs_test_actor|club-button|Heron|Osprey|Placeholder rules|Rigger|Who is checking in|I'm here|Front-desk iPad|Sign in|sign-in link|Test outbox|Which of you|Email me|Yoga|Erg Conditioning|Stretch|Boathouse gym|Members' Dinner|Regatta Social|Work Party|Replying as|Staff office|Check someone in|Needs a look|Import households|roster|Monthly billing|Bar and snack-bar|Bringing visitors|Record visitors|Recent charges|QuickBooks|Membership Dues|Guest Fees|Snack Bar Sales|Old bookings|old bookings|iCrew|Reservations report|End memberships|Yes, end|Resignations file|Load the equipment|Equipment sheet|Yes, add|private boat|Tour requests|Mark followed up|Welcome back|Watercooler|home screen|CCS Members|webmanifest|Report damage|Damage reports|File the report|Mark as repaired|Dismiss the report|Mark as being fixed/i);
      }
    });

    test("the picker's request handler does nothing and sets no cookie", async () => {
      for (const actor of ["staff", `member:${FIRST_HOUSEHOLD}`, "none"]) {
        const res = await fetch(`${base}/api/club/act-as`, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ actor }),
        });
        expect(res.status, actor).toBe(404);
        expect(res.headers.get("set-cookie"), actor).toBeNull();
      }
    });

    test("no booking, cancelling, equipment, class, event, check-in or household request does anything, even with a test-member cookie", async () => {
      const posts: [string, Record<string, string>][] = [
        ["/api/club/bookings", { item: FIRST_HOUSEHOLD, start: "2026-10-29T14:00:00.000Z", minutes: "60", for: FIRST_HOUSEHOLD }],
        ["/api/club/bookings/cancel", { id: FIRST_HOUSEHOLD }],
        ["/api/club/equipment/out-of-service", { item: FIRST_HOUSEHOLD, reason: "Test" }],
        ["/api/club/equipment/return", { period: FIRST_HOUSEHOLD }],
        ["/api/club/classes/sign-up", { session: FIRST_HOUSEHOLD, for: FIRST_HOUSEHOLD }],
        ["/api/club/classes/leave", { id: FIRST_HOUSEHOLD }],
        ["/api/club/classes/create", { name: "Test", chairs: "5", minutes: "60" }],
        ["/api/club/classes/schedule", { class: FIRST_HOUSEHOLD, date: "2026-10-30", time: "07:00", weeks: "1" }],
        ["/api/club/classes/cancel-session", { session: FIRST_HOUSEHOLD, reason: "Test" }],
        ["/api/club/classes/capacity", { session: FIRST_HOUSEHOLD, capacity: "5" }],
        ["/api/club/events/rsvp", { event: FIRST_HOUSEHOLD, people: "2", for: FIRST_HOUSEHOLD }],
        ["/api/club/events/leave", { id: FIRST_HOUSEHOLD }],
        ["/api/club/events/guests", { id: FIRST_HOUSEHOLD, people: "2" }],
        ["/api/club/events/keep", { id: FIRST_HOUSEHOLD }],
        ["/api/club/events/link", { event: FIRST_HOUSEHOLD, member: FIRST_HOUSEHOLD, token: "A".repeat(43), action: "rsvp", people: "1" }],
        ["/api/club/events/create", { title: "Test", date: "2026-11-04", start: "19:00", end: "21:00" }],
        ["/api/club/events/update", { event: FIRST_HOUSEHOLD, title: "Test" }],
        ["/api/club/events/cancel", { event: FIRST_HOUSEHOLD, reason: "Test" }],
        ["/api/club/attendance", { kind: "booking", id: FIRST_HOUSEHOLD, outcome: "attended", back: "/club/admin" }],
        ["/api/club/check-in", { kind: "booking", id: FIRST_HOUSEHOLD, back: "/club/my-bookings" }],
        ["/api/club/sign-in/request", { email: "erik.lindqvist@example.com" }],
        ["/api/club/sign-in/confirm", { token: "A".repeat(43), identity: "staff:alex.staffer@example.org" }],
        ["/api/club/sign-out", {}],
        ["/api/club/ipad/check-in", { code: IPAD_CODE, member: FIRST_HOUSEHOLD, kind: "booking", id: FIRST_HOUSEHOLD }],
        ["/api/club/ipad/visitors", { code: IPAD_CODE, member: FIRST_HOUSEHOLD, visitors: "2" }],
        ["/api/club/households/create", { name: "Test", type: "Resident", joined: "2026-10-22", firstName: "A", lastName: "B", email: "a@example.com" }],
        ["/api/club/households/add-member", { household: FIRST_HOUSEHOLD, firstName: "A", lastName: "B", email: "a@example.com" }],
        ["/api/club/households/remove-member", { household: FIRST_HOUSEHOLD, member: FIRST_HOUSEHOLD }],
        ["/api/club/households/update-member", { household: FIRST_HOUSEHOLD, member: FIRST_HOUSEHOLD, firstName: "A", lastName: "B", email: "a@example.com" }],
        ["/club/admin/import", {}],
        ["/api/club/households/change-type", { household: FIRST_HOUSEHOLD, type: "Resident" }],
        ["/api/club/households/grant", { household: FIRST_HOUSEHOLD, member: FIRST_HOUSEHOLD, code: "scull-1" }],
        ["/api/club/households/end", { household: FIRST_HOUSEHOLD }],
      ];
      for (const [path, body] of posts) {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: "ccs_test_actor=staff" },
          body: new URLSearchParams(body),
        });
        expect(res.status, path).toBe(404);
        expect(res.headers.get("location"), path).toBeNull();
      }
    });

    test("every staff screen button that is a Next.js server action, called with its real ID as the browser would, answers 'page not found' and does nothing", async () => {
      // The staff screens use server actions instead of form handlers, so each is called here with the ID the build gave it. The list is
      // checked against the build, so an action added later cannot be left out of this test without it failing.
      const ACTIONS: Record<string, string> = {
        importRoster: "/club/admin/import",
        importHistory: "/club/admin/history",
        endHouseholds: "/club/admin/resignations",
        loadEquipment: "/club/admin/equipment-import",
        inviteToMyBoat: "/club/my-boats",
        removeFromMyBoat: "/club/my-boats",
        makeOwner: "/club/admin/boats",
        inviteAsStaff: "/club/admin/boats",
        takeOffBoat: "/club/admin/boats",
        fileDamage: "/club/damage",
        addDamageNoteAction: "/club/damage",
        assignReport: "/club/admin/damage",
        changePriority: "/club/admin/damage",
        startReport: "/club/admin/damage",
        outOfServiceForReport: "/club/admin/damage",
        repairedReport: "/club/admin/damage",
        dismissReport: "/club/admin/damage",
        markFollowedUp: "/club/admin/tours",
        // The public Request a tour form is a server action too, on the public site, which has its own switch (see site-hidden.spec.ts).
        requestTour: "/site/request-a-tour",
        addCharge: "/club/admin/charges",
        voidChargeAction: "/club/admin/charges",
        addVisitors: "/club/admin/visitors",
        voidVisitorsAction: "/club/admin/visitors",
        closeMonth: "/club/admin/billing",
        saveQuickbooksId: `/club/household/${FIRST_HOUSEHOLD}`,
      };
      const manifest = JSON.parse(readFileSync(join(process.cwd(), ".next/server/server-reference-manifest.json"), "utf8")) as { node: Record<string, { exportedName?: string }> };
      const built = Object.entries(manifest.node).map(([id, action]) => ({ id, name: action.exportedName ?? "" }));
      expect(built.map((a) => a.name).sort(), "the build has exactly these server actions, each once").toEqual(Object.keys(ACTIONS).sort());
      for (const { id, name } of built) {
        for (const extra of [{}, { Cookie: "ccs_test_actor=staff" }] as Record<string, string>[]) {
          const res = await fetch(`${base}${ACTIONS[name]}`, {
            method: "POST",
            redirect: "manual",
            headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", ...extra },
            body: "[]",
          });
          expect(res.status, `${name} ${JSON.stringify(extra)}`).toBe(404);
          expect(await res.text(), `${name} ${JSON.stringify(extra)}`).not.toMatch(/Import households|roster|Check the file|Staff office|Households|Lindqvist|Test staff|invented|test build|Monthly billing|Recent charges|Add a charge|Record visitors|QuickBooks|added to|recorded for|is closed|old booking|iCrew|End memberships|Yes, end|Resignations file|Load the equipment|Equipment sheet|Yes, add|private boat|Tour requests|followed up|Request a tour|Send request|My boats|Private boats|Make owner|Take off|no owner|Report damage|Damage reports|File the report|Mark as repaired|Dismiss the report|Note added/i);
        }
      }
    });

    test("a cookie for a test member opens nothing", async () => {
      const res = await fetch(`${base}/club`, { headers: { Cookie: "ccs_test_actor=staff" } });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toMatch(/Households|Lindqvist/);
    });

    test("a signed-in cookie opens nothing, and no sign-in email is ever made or sent", async () => {
      const res = await fetch(`${base}/club/my-bookings`, { headers: { Cookie: `ccs_session=${"A".repeat(43)}; ccs_signin_who=staff:alex.staffer@example.org` } });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toMatch(/Signed in as|My bookings|Alex Staffer/);
      const asked = await fetch(`${base}/api/club/sign-in/request`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "alex.staffer@example.org" }) });
      expect(asked.status).toBe(404);
      expect(asked.headers.get("set-cookie")).toBeNull();
      expect(asked.headers.get("location")).toBeNull();
    });

    test("the rest of the site is untouched", async ({ page }) => {
      // Static dashboard pages still open (their data is loaded separately and is not part of this check).
      for (const path of ["/", "/visits", "/timing", "/shells", "/reservations", "/email", "/goals"]) {
        const res = await page.goto(`${base}${path}`);
        expect(res?.status(), path).toBe(200);
      }
    });
  });
}
