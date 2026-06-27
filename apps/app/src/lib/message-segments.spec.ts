import { segmentMessage } from "./message-segments";

/**
 * Unit coverage for chat-message segmentation (issue #24, story 44). The
 * behaviour the slice guarantees is that URL-like text is *identified as a
 * distinct, non-text segment* so the chat view can render it as inert plain text
 * rather than a clickable link — and that segmentation is lossless, so no message
 * content is dropped or rewritten on the way to the screen.
 */
describe("segmentMessage", () => {
  it("returns an empty array for an empty string", () => {
    expect(segmentMessage("")).toEqual([]);
  });

  it("returns a single text segment when there is no URL", () => {
    expect(segmentMessage("hey how are you")).toEqual([
      { type: "text", value: "hey how are you" },
    ]);
  });

  it("marks a scheme-prefixed URL as a url segment, not text (story 44)", () => {
    const segments = segmentMessage("look at https://evil.example.com now");

    expect(segments).toEqual([
      { type: "text", value: "look at " },
      { type: "url", value: "https://evil.example.com" },
      { type: "text", value: " now" },
    ]);
  });

  it("detects a bare host.tld domain as a url segment", () => {
    const segments = segmentMessage("dm me at sketchy.site for details");

    expect(segments).toEqual([
      { type: "text", value: "dm me at " },
      { type: "url", value: "sketchy.site" },
      { type: "text", value: " for details" },
    ]);
  });

  it("detects a www-prefixed URL regardless of TLD", () => {
    expect(segmentMessage("www.foo.bar")).toEqual([
      { type: "url", value: "www.foo.bar" },
    ]);
  });

  it("trims trailing sentence punctuation off the url segment", () => {
    const segments = segmentMessage("go to https://a.com.");

    expect(segments).toEqual([
      { type: "text", value: "go to " },
      { type: "url", value: "https://a.com" },
      { type: "text", value: "." },
    ]);
  });

  it("handles multiple URLs in one message in order", () => {
    const segments = segmentMessage("a.com then b.io done");

    expect(segments).toEqual([
      { type: "url", value: "a.com" },
      { type: "text", value: " then " },
      { type: "url", value: "b.io" },
      { type: "text", value: " done" },
    ]);
  });

  it("does not misread ordinary prose with a period as a link", () => {
    expect(segmentMessage("ok. bye for now")).toEqual([
      { type: "text", value: "ok. bye for now" },
    ]);
  });

  it("is lossless — concatenating segment values reproduces the input", () => {
    const input = "ping me: www.example.com/path?x=1 or mail.io thanks!";

    const rejoined = segmentMessage(input)
      .map((segment) => segment.value)
      .join("");

    expect(rejoined).toBe(input);
  });

  it("never emits a clickable affordance — only text and url segment types", () => {
    const segments = segmentMessage("here https://x.io and y.com");

    for (const segment of segments) {
      expect(["text", "url"]).toContain(segment.type);
    }
  });
});
