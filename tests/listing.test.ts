import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { finishList, likePattern, listHref, parseListQuery } from "@/lib/admin/listing";

/**
 * Everything on these lists arrives from the address bar, so the parse
 * is where a bad value has to be turned into a sane one — before it
 * reaches a query.
 */
const opts = { sortable: ["name", "code", "status"], defaultSort: "name" } as const;

describe("parseListQuery", () => {
  it("defaults everything", () => {
    expect(parseListQuery({}, opts)).toEqual({
      q: "", status: "all", sort: "name", dir: "asc", page: 1, size: 20, extra: {},
    });
  });

  it("refuses an unknown sort key rather than passing it through", () => {
    // The sort key becomes a column choice. An unknown one must fall
    // back, not reach SQL.
    expect(parseListQuery({ sort: "id; drop table" }, opts).sort).toBe("name");
    expect(parseListQuery({ sort: "code" }, opts).sort).toBe("code");
  });

  it("snaps the page size to the menu", () => {
    expect(parseListQuery({ size: "100000" }, opts).size).toBe(20);
    expect(parseListQuery({ size: "50" }, opts).size).toBe(50);
    expect(parseListQuery({ size: "-1" }, opts).size).toBe(20);
  });

  it("ignores a nonsense page and direction", () => {
    expect(parseListQuery({ page: "0" }, opts).page).toBe(1);
    expect(parseListQuery({ page: "abc" }, opts).page).toBe(1);
    expect(parseListQuery({ dir: "sideways" }, opts).dir).toBe("asc");
  });

  it("takes the first value when a key repeats", () => {
    expect(parseListQuery({ q: ["mum", "pune"] }, opts).q).toBe("mum");
  });

  it("only keeps the extra keys the screen declared", () => {
    const q = parseListQuery({ state: "7", evil: "1" }, { ...opts, extraKeys: ["state"] });
    expect(q.extra).toEqual({ state: "7" });
  });
});

describe("finishList", () => {
  it("clamps a page past the end to the last page", () => {
    const q = parseListQuery({ page: "99" }, opts);
    expect(finishList(q, 60, opts.sortable).page).toBe(3); // 60 / 20
    expect(finishList(q, 0, opts.sortable)).toMatchObject({ page: 1, pages: 1 });
  });
});

describe("likePattern", () => {
  it("escapes the user's wildcards", () => {
    // `_` and `%` typed by a person are literal characters to them.
    expect(likePattern("a_b%c")).toBe("%a\\_b\\%c%");
  });
});

describe("listHref", () => {
  const cur = { q: "", status: "all" as const, sort: "name", dir: "asc" as const, page: 3, size: 20, extra: {} };

  it("resets the page when the search changes", () => {
    expect(listHref("/x", cur, { q: "mum" })).toBe("/x?q=mum&sort=name");
  });

  it("keeps the page when only the page changes", () => {
    expect(listHref("/x", cur, { page: 4 })).toBe("/x?sort=name&page=4");
  });

  it("omits defaults so the clean URL stays clean", () => {
    expect(listHref("/x", { ...cur, page: 1 }, {})).toBe("/x?sort=name");
  });

  it("drops an extra filter cleared to empty", () => {
    expect(listHref("/x", { ...cur, extra: { state: "7" } }, { extra: { state: "" } })).toBe(
      "/x?sort=name",
    );
  });
});

describe("the admin lists navigate with the browser", () => {
  const controls = readFileSync(
    new URL("../src/components/admin/ListControls.tsx", import.meta.url),
    "utf8",
  );
  it("uses GET forms and anchors, never the router", () => {
    // Comments explain the decision at length; strip them before
    // asserting the code keeps it.
    const code = controls.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/<form\s+method="get"/);
    expect(code).not.toMatch(/useRouter|next\/link|router\.(push|replace)/);
  });
});

describe("marketing pages hand off to the auth area with a real page load", () => {
  /**
   * "On some computers, clicking Sign in does nothing." The home page
   * is static and sits open in tabs for hours; every deploy renames the
   * chunks it references, and a `<Link>` from that stale tab to /sign-in
   * asks the router for files that no longer exist — and fails without
   * a word. An anchor cannot. Same disease as the admin sidebar, same
   * cure.
   */
  for (const file of ["../src/components/PageShell.tsx", "../src/app/page.tsx"]) {
    it(`${file} links to sign-in/sign-up with <a>`, () => {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      const bad = src.match(/<Link[^>]*href="\/sign-(in|up)"/g);
      expect(bad ?? []).toEqual([]);
      expect(src).toMatch(/<a[^>]*href="\/sign-in"/);
    });
  }
});
