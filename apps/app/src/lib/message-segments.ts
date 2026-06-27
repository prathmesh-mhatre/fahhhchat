import { findUrlLikeSpans } from "@fahhhchat/config";

/**
 * Splits an incoming chat message into render segments so a chat view can show
 * URL-like text as inert plain text rather than a clickable link (issue #24,
 * story 44). Phishing and outbound-routing risk is reduced by *never* emitting an
 * anchor: a renderer maps every segment — `text` and `url` alike — to a non-
 * interactive node (a `<span>`), using the `url` type only to style the run
 * differently (e.g. muted/underlined) so the reader can see it is a link without
 * being able to follow it.
 *
 * The module is deliberately a pure, framework-agnostic helper (no React, no
 * DOM), mirroring {@link import("./outgoing-messages")} — the URL detection
 * itself is the shared {@link findUrlLikeSpans} from `@fahhhchat/config`, so the
 * web app marks exactly the spans the API meters for spam (story 45) and the two
 * surfaces can never drift on what "URL-like" means.
 */

/** What a single run of a segmented message is. */
export type MessageSegmentType = "text" | "url";

/** One contiguous run of a message: ordinary text, or a URL-like run. */
export interface MessageSegment {
  type: MessageSegmentType;
  /** The substring this segment covers. */
  value: string;
}

/**
 * Segment `text` into alternating plain-text and URL-like runs, in order, such
 * that concatenating every {@link MessageSegment.value} reproduces the original
 * string exactly (no characters are dropped or rewritten). A message with no
 * URL-like content yields a single `text` segment; an empty string yields an
 * empty array. The `url` segments are *identified, not linkified* — it is the
 * renderer's contract to draw them as non-clickable text (story 44).
 */
export function segmentMessage(text: string): MessageSegment[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const spans = findUrlLikeSpans(text);
  if (spans.length === 0) {
    return [{ type: "text", value: text }];
  }

  const segments: MessageSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    // Plain text before this URL (if any).
    if (span.start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, span.start) });
    }
    segments.push({ type: "url", value: span.value });
    cursor = span.end;
  }
  // Trailing plain text after the last URL (if any).
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments;
}
