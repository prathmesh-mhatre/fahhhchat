import { OutgoingMessageTracker } from "./outgoing-messages";

/**
 * Unit coverage for the sender's outgoing-message lifecycle (issue #23). The two
 * behaviours the slice exists to guarantee are the retry state while the match is
 * valid (story 42) and the hard stop once it ends (story 43); the rest pin down
 * the surrounding transitions so neither guard can regress unnoticed.
 */
describe("OutgoingMessageTracker", () => {
  it("starts a queued message in the sending state", () => {
    const tracker = new OutgoingMessageTracker();

    const message = tracker.queue("c-1", "hello");

    expect(message.status).toBe("sending");
    expect(message.failureReason).toBeNull();
    expect(tracker.get("c-1")?.status).toBe("sending");
  });

  it("clears the pending state when the server acknowledges delivery (story 39)", () => {
    const tracker = new OutgoingMessageTracker();
    tracker.queue("c-1", "hello");

    tracker.ack("c-1");

    expect(tracker.get("c-1")?.status).toBe("sent");
    expect(tracker.canRetry("c-1")).toBe(false);
  });

  describe("retry while the match is valid (story 42)", () => {
    it("marks a timed-out send as failed and retryable", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "hello");

      tracker.fail("c-1", "timeout");

      expect(tracker.get("c-1")?.status).toBe("failed");
      expect(tracker.get("c-1")?.failureReason).toBe("timeout");
      expect(tracker.canRetry("c-1")).toBe(true);
    });

    it("re-arms a failed message for sending and returns its original text", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "hello");
      tracker.fail("c-1", "timeout");

      const requeued = tracker.retry("c-1");

      expect(requeued?.text).toBe("hello");
      expect(requeued?.status).toBe("sending");
      expect(tracker.get("c-1")?.status).toBe("sending");
      // A retry that then succeeds settles as delivered.
      tracker.ack("c-1");
      expect(tracker.get("c-1")?.status).toBe("sent");
    });
  });

  describe("stop retrying after the match ends (story 43)", () => {
    it("turns every pending and failed message undelivered when the match ends", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-sending", "still in flight");
      tracker.queue("c-failed", "already failed");
      tracker.fail("c-failed", "timeout");
      tracker.queue("c-sent", "got through");
      tracker.ack("c-sent");

      tracker.endMatch();

      expect(tracker.get("c-sending")?.status).toBe("undelivered");
      expect(tracker.get("c-failed")?.status).toBe("undelivered");
      // A delivered message is not disturbed by the match ending.
      expect(tracker.get("c-sent")?.status).toBe("sent");
    });

    it("refuses to retry an undelivered message after the match ends", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "hello");
      tracker.fail("c-1", "timeout");
      tracker.endMatch();

      const requeued = tracker.retry("c-1");

      expect(requeued).toBeNull();
      expect(tracker.canRetry("c-1")).toBe(false);
      expect(tracker.get("c-1")?.status).toBe("undelivered");
    });

    it("settles a message refused as match_ended as undelivered", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "anyone there?");

      tracker.fail("c-1", "match_ended");

      expect(tracker.get("c-1")?.status).toBe("undelivered");
      expect(tracker.canRetry("c-1")).toBe(false);
    });

    it("treats a late timeout after the match ended as undelivered, never failed", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "hello");
      tracker.endMatch();

      // A retry-timeout firing after the chat is gone must not reopen a retry.
      tracker.fail("c-1", "timeout");

      expect(tracker.get("c-1")?.status).toBe("undelivered");
      expect(tracker.canRetry("c-1")).toBe(false);
    });

    it("records a message queued after the match ended as undelivered", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.endMatch();

      const message = tracker.queue("c-1", "too late");

      expect(message.status).toBe("undelivered");
      expect(tracker.canRetry("c-1")).toBe(false);
    });

    it("is idempotent when the match ends twice", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "hello");

      tracker.endMatch();
      tracker.endMatch();

      expect(tracker.get("c-1")?.status).toBe("undelivered");
    });
  });

  describe("validation rejections", () => {
    it("marks an empty or too-long send rejected and not retryable", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "   ");
      tracker.queue("c-2", "x".repeat(9000));

      tracker.fail("c-1", "empty");
      tracker.fail("c-2", "too_long");

      expect(tracker.get("c-1")?.status).toBe("rejected");
      expect(tracker.get("c-2")?.status).toBe("rejected");
      expect(tracker.canRetry("c-1")).toBe(false);
      expect(tracker.canRetry("c-2")).toBe(false);
    });

    it("settles a link-spam refusal as rejected, not retryable (story 45)", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "join https://spam.example.com");

      tracker.fail("c-1", "spam");

      // The match is still live, but re-sending the same link immediately would
      // just be refused again, so it is terminal-rejected rather than `failed`.
      expect(tracker.get("c-1")?.status).toBe("rejected");
      expect(tracker.get("c-1")?.failureReason).toBe("spam");
      expect(tracker.canRetry("c-1")).toBe(false);
    });

    it("keeps a rejection's specific reason when the match later ends", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "   ");
      tracker.fail("c-1", "empty");

      tracker.endMatch();

      // A validation rejection is already terminal and unrelated to match end.
      expect(tracker.get("c-1")?.status).toBe("rejected");
      expect(tracker.get("c-1")?.failureReason).toBe("empty");
    });
  });

  describe("guards against resurrecting settled messages", () => {
    it("ignores a late ack for an already-failed message", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "hello");
      tracker.fail("c-1", "timeout");

      tracker.ack("c-1");

      expect(tracker.get("c-1")?.status).toBe("failed");
    });

    it("ignores a late failure for an already-delivered message", () => {
      const tracker = new OutgoingMessageTracker();
      tracker.queue("c-1", "hello");
      tracker.ack("c-1");

      tracker.fail("c-1", "timeout");

      expect(tracker.get("c-1")?.status).toBe("sent");
    });

    it("ignores acks, failures, and retries for an unknown id", () => {
      const tracker = new OutgoingMessageTracker();

      expect(() => tracker.ack("nope")).not.toThrow();
      expect(() => tracker.fail("nope", "timeout")).not.toThrow();
      expect(tracker.retry("nope")).toBeNull();
      expect(tracker.get("nope")).toBeUndefined();
    });
  });

  it("lists tracked messages in send order as defensive copies", () => {
    const tracker = new OutgoingMessageTracker();
    tracker.queue("c-1", "first");
    tracker.queue("c-2", "second");

    const list = tracker.list();
    expect(list.map((m) => m.clientMessageId)).toEqual(["c-1", "c-2"]);

    // Mutating a snapshot must not bleed back into tracker state.
    list[0].status = "sent";
    expect(tracker.get("c-1")?.status).toBe("sending");
  });
});
