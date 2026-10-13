import { expect, test } from "@playwright/test";

// Plain fetch carries no saved credentials, like a stranger's browser.
const basic = (pass: string) => "Basic " + Buffer.from(`ccs:${pass}`).toString("base64");

test.describe("password gate", () => {
  test("asks for a password when none is given", async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  test("keeps the data endpoint locked too", async ({ baseURL }) => {
    expect((await fetch(`${baseURL}/api/dashboard`)).status).toBe(401);
  });

  test("rejects the wrong password", async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/`, { headers: { authorization: basic("wrong") } });
    expect(res.status).toBe(401);
  });

  test("lets the right password in", async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/`, { headers: { authorization: basic("e2e-test-password") } });
    expect(res.status).toBe(200);
  });
});
