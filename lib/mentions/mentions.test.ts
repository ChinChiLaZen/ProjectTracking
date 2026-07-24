import { describe, expect, it } from "vitest";
import {
  detectActiveMentionQuery,
  extractMentionedUserIds,
  extractMentionTokens,
  insertMentionToken,
  splitBodyIntoSegments,
} from "./mentions";

describe("extractMentionTokens", () => {
  it("returns an empty array for a body with no mentions", () => {
    expect(extractMentionTokens("just plain text")).toEqual([]);
    expect(extractMentionTokens("")).toEqual([]);
  });

  it("extracts a single mention with correct offsets", () => {
    const body = "hey @[Alice Smith](user-1) check this out";
    const tokens = extractMentionTokens(body);
    expect(tokens).toEqual([{ userId: "user-1", name: "Alice Smith", start: 4, end: 26 }]);
    expect(body.slice(tokens[0]!.start, tokens[0]!.end)).toBe("@[Alice Smith](user-1)");
  });

  it("extracts multiple mentions in order", () => {
    const body = "@[Alice](u1) and @[Bob](u2) should look at this";
    const tokens = extractMentionTokens(body);
    expect(tokens.map((t) => t.userId)).toEqual(["u1", "u2"]);
    expect(tokens.map((t) => t.name)).toEqual(["Alice", "Bob"]);
  });

  it("ignores malformed/unterminated tokens", () => {
    expect(extractMentionTokens("@[Alice](u1")).toEqual([]); // missing close paren
    expect(extractMentionTokens("@[Alice] (u1)")).toEqual([]); // space breaks adjacency
    expect(extractMentionTokens("@Alice(u1)")).toEqual([]); // missing brackets
  });
});

describe("extractMentionedUserIds", () => {
  it("dedupes repeated mentions of the same user", () => {
    const body = "@[Alice](u1) ping @[Alice](u1) again";
    expect(extractMentionedUserIds(body)).toEqual(["u1"]);
  });

  it("preserves first-appearance order for distinct users", () => {
    const body = "@[Bob](u2) then @[Alice](u1)";
    expect(extractMentionedUserIds(body)).toEqual(["u2", "u1"]);
  });

  it("returns an empty array when there are no mentions", () => {
    expect(extractMentionedUserIds("no mentions here")).toEqual([]);
  });
});

describe("splitBodyIntoSegments", () => {
  it("returns a single text segment for a plain body", () => {
    expect(splitBodyIntoSegments("hello world")).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("returns an empty array for an empty body", () => {
    expect(splitBodyIntoSegments("")).toEqual([]);
  });

  it("splits text/mention/text correctly", () => {
    const body = "hey @[Alice](u1) welcome";
    expect(splitBodyIntoSegments(body)).toEqual([
      { type: "text", text: "hey " },
      { type: "mention", userId: "u1", name: "Alice" },
      { type: "text", text: " welcome" },
    ]);
  });

  it("handles a body starting with a mention (no leading text segment)", () => {
    const body = "@[Alice](u1) hi";
    expect(splitBodyIntoSegments(body)).toEqual([
      { type: "mention", userId: "u1", name: "Alice" },
      { type: "text", text: " hi" },
    ]);
  });

  it("handles two consecutive mentions with no text between them", () => {
    const body = "@[Alice](u1)@[Bob](u2)";
    expect(splitBodyIntoSegments(body)).toEqual([
      { type: "mention", userId: "u1", name: "Alice" },
      { type: "mention", userId: "u2", name: "Bob" },
    ]);
  });

  it("handles a body that is only a mention (no trailing text segment)", () => {
    expect(splitBodyIntoSegments("@[Alice](u1)")).toEqual([{ type: "mention", userId: "u1", name: "Alice" }]);
  });
});

describe("detectActiveMentionQuery", () => {
  it("detects a trigger at the very start of the text", () => {
    expect(detectActiveMentionQuery("@ali", 4)).toEqual({ query: "ali", start: 0 });
  });

  it("detects a trigger right after whitespace", () => {
    expect(detectActiveMentionQuery("hey @ali", 8)).toEqual({ query: "ali", start: 4 });
  });

  it("returns null with no @ before the cursor", () => {
    expect(detectActiveMentionQuery("hello world", 5)).toBeNull();
  });

  it("returns null once the query contains whitespace (trigger already closed)", () => {
    expect(detectActiveMentionQuery("hey @ali ce", 11)).toBeNull();
  });

  it("returns null mid-word, e.g. an email address", () => {
    expect(detectActiveMentionQuery("me@example.com", 14)).toBeNull();
  });

  it("returns null once the query contains a token-closing character", () => {
    expect(detectActiveMentionQuery("@[Alice](u1", 11)).toBeNull();
  });

  it("detects an empty query right after typing just '@'", () => {
    expect(detectActiveMentionQuery("hi @", 4)).toEqual({ query: "", start: 3 });
  });

  it("only considers text up to the cursor, not the full string", () => {
    // cursor sits right after "@al", ignoring the "ice)" typed later in the string
    expect(detectActiveMentionQuery("@alice) more", 3)).toEqual({ query: "al", start: 0 });
  });
});

describe("insertMentionToken", () => {
  it("replaces the active query span with a token and trailing space", () => {
    const text = "hey @ali there";
    const active = detectActiveMentionQuery(text, 8)!; // cursor right after "ali"
    const result = insertMentionToken(text, active, 8, "Alice Smith", "user-1");
    expect(result.text).toBe("hey @[Alice Smith](user-1) there");
    expect(result.cursorPos).toBe("hey @[Alice Smith](user-1) ".length);
  });

  it("works when the query is empty (token inserted right after '@')", () => {
    const text = "hi @";
    const active = detectActiveMentionQuery(text, 4)!;
    const result = insertMentionToken(text, active, 4, "Bob", "user-2");
    expect(result.text).toBe("hi @[Bob](user-2) ");
  });

  it("does not double up whitespace when the cursor sits right before an existing space", () => {
    const text = "hey @ali there";
    const active = detectActiveMentionQuery(text, 8)!; // cursor right after "ali", before the space
    const result = insertMentionToken(text, active, 8, "Alice Smith", "user-1");
    expect(result.text).toBe("hey @[Alice Smith](user-1) there");
  });
});
