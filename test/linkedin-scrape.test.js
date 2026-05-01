import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { extractLinkedInUsername, formatScrapeAsContextBlock } from "../lib/linkedin-scrape.js";

describe("linkedin-scrape helpers", () => {
  describe("extractLinkedInUsername", () => {
    it("extracts from full URL", () => {
      assert.equal(extractLinkedInUsername("https://linkedin.com/in/alexdg"), "alexdg");
      assert.equal(extractLinkedInUsername("https://www.linkedin.com/in/alex-dg-12345/"), "alex-dg-12345");
    });
    it("returns bare slug as-is", () => {
      assert.equal(extractLinkedInUsername("alexdg"), "alexdg");
    });
    it("strips query and fragment", () => {
      assert.equal(extractLinkedInUsername("https://linkedin.com/in/alex?utm=x"), "alex");
      assert.equal(extractLinkedInUsername("https://linkedin.com/in/alex#section"), "alex");
    });
    it("returns null on garbage / non-string", () => {
      assert.equal(extractLinkedInUsername(""), null);
      assert.equal(extractLinkedInUsername(null), null);
      assert.equal(extractLinkedInUsername("not a url"), null);
      assert.equal(extractLinkedInUsername(42), null);
    });
  });

  describe("formatScrapeAsContextBlock", () => {
    it("returns empty string on null/missing profile", () => {
      assert.equal(formatScrapeAsContextBlock(null), "");
      assert.equal(formatScrapeAsContextBlock({}), "");
    });
    it("renders [Contexte lead — NAME] header + headline + body", () => {
      const out = formatScrapeAsContextBlock({
        profile: { name: "Alex DG", headline: "Founder of X", text: "Founder bio paragraph." },
        posts: [], postCount: 0,
      });
      assert.match(out, /^\[Contexte lead — Alex DG\]/);
      assert.match(out, /Founder of X/);
      assert.match(out, /Founder bio paragraph\./);
    });
    it("includes posts (max 5) under 'Posts récents'", () => {
      const out = formatScrapeAsContextBlock({
        profile: { name: "X", headline: "h", text: "t" },
        posts: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
        postCount: 7,
      });
      assert.match(out, /Posts récents/);
      assert.match(out, /- p1/);
      assert.match(out, /- p5/);
      assert.equal(out.includes("- p6"), false);
    });
    it("truncates long posts to 400 chars + ellipsis", () => {
      const long = "x".repeat(800);
      const out = formatScrapeAsContextBlock({
        profile: { name: "X", headline: "", text: "" },
        posts: [long], postCount: 1,
      });
      assert.match(out, /x{400}…/);
    });
  });
});
