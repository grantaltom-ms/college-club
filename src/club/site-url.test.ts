import { describe, expect, it } from "vitest";
import { configuredSiteOrigin } from "./site-url";

describe("the site's own address for links in emails", () => {
  it("is nothing when nothing is set", () => {
    expect(configuredSiteOrigin({})).toBeUndefined();
    expect(configuredSiteOrigin({ CLUB_SITE_URL: "" })).toBeUndefined();
    expect(configuredSiteOrigin({ CLUB_SITE_URL: "   " })).toBeUndefined();
  });

  it("is the address without a path, for an https or http address", () => {
    expect(configuredSiteOrigin({ CLUB_SITE_URL: "https://club.example.org/some/page?x=1" })).toBe("https://club.example.org");
    expect(configuredSiteOrigin({ CLUB_SITE_URL: " http://localhost:3000/ " })).toBe("http://localhost:3000");
  });

  it("is null, not a guess, for anything that is not a web address", () => {
    for (const bad of ["club.example.org", "ftp://club.example.org", "javascript:alert(1)", "not a url", "//club.example.org"]) expect(configuredSiteOrigin({ CLUB_SITE_URL: bad }), bad).toBeNull();
  });
});
