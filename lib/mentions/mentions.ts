// @mention parsing/rendering (Session 14). Tokens are embedded directly in
// Update.body as `@[Display Name](userId)` — unambiguous to parse with a
// fixed regex, keeps `body` a single plain string (no schema change to it),
// and is trivially round-trippable (the autocomplete inserts the token;
// rendering re-parses it). This is deliberately narrower than a rich-text
// format — see the schema comment on Update.mentionedUserIds.

export type MentionToken = { userId: string; name: string; start: number; end: number };

const MENTION_TOKEN_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

export function extractMentionTokens(body: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  for (const match of body.matchAll(MENTION_TOKEN_REGEX)) {
    if (match.index === undefined) continue;
    const [full, name, userId] = match;
    if (!name || !userId) continue;
    tokens.push({ userId, name, start: match.index, end: match.index + full.length });
  }
  return tokens;
}

// Deduped, in first-appearance order — the set of ids a comment's body
// actually names, before server-side validation against real board
// membership (server/services/updates.ts does that intersection).
export function extractMentionedUserIds(body: string): string[] {
  const seen = new Set<string>();
  for (const token of extractMentionTokens(body)) {
    seen.add(token.userId);
  }
  return Array.from(seen);
}

export type BodySegment = { type: "text"; text: string } | { type: "mention"; userId: string; name: string };

// Splits body into renderable text/mention segments, in order. Purely
// syntactic — independent of Update.mentionedUserIds — so rendering never
// needs a server round trip beyond the already-fetched board member list
// used to resolve a mention's *current* display name (see UpdatesPanel).
export function splitBodyIntoSegments(body: string): BodySegment[] {
  const tokens = extractMentionTokens(body);
  if (tokens.length === 0) {
    return body.length > 0 ? [{ type: "text", text: body }] : [];
  }

  const segments: BodySegment[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ type: "text", text: body.slice(cursor, token.start) });
    }
    segments.push({ type: "mention", userId: token.userId, name: token.name });
    cursor = token.end;
  }
  if (cursor < body.length) {
    segments.push({ type: "text", text: body.slice(cursor) });
  }
  return segments;
}

export type ActiveMentionQuery = { query: string; start: number };

// Finds the "@word" the user is currently mid-typing immediately before the
// cursor, if any — the autocomplete-trigger detector. Returns null when
// there's no unclosed "@" right before the cursor, when the query contains
// whitespace (a space ends the trigger), when it contains a token-closing
// character (meaning this "@" is inside/after an already-completed token,
// not a fresh one), or when the "@" isn't at the very start of the text or
// preceded by whitespace (so "email@domain" mid-word never triggers it).
export function detectActiveMentionQuery(text: string, cursorPos: number): ActiveMentionQuery | null {
  const upToCursor = text.slice(0, cursorPos);
  const atIndex = upToCursor.lastIndexOf("@");
  if (atIndex === -1) return null;

  const query = upToCursor.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  if (/[[\]()]/.test(query)) return null;

  const before = atIndex > 0 ? text[atIndex - 1] : undefined;
  if (before !== undefined && !/\s/.test(before)) return null;

  return { query, start: atIndex };
}

// Replaces the active "@query" span with a real mention token, returning
// the new text and where the cursor should land afterward (end of the
// inserted token + trailing space).
export function insertMentionToken(
  text: string,
  active: ActiveMentionQuery,
  cursorPos: number,
  name: string,
  userId: string,
): { text: string; cursorPos: number } {
  const token = `@[${name}](${userId}) `;
  // The token already ends in a space — if the cursor sits right before
  // existing whitespace (mentioning mid-sentence), skip that one character
  // so it doesn't double up into "token  rest".
  const restStart = text[cursorPos] === " " ? cursorPos + 1 : cursorPos;
  const newText = text.slice(0, active.start) + token + text.slice(restStart);
  return { text: newText, cursorPos: active.start + token.length };
}
