/**
 * The sender's view of an outgoing message's lifecycle (issue #23, stories 42 &
 * 43). This is the client half of the realtime chat contract the API already
 * enforces: the server stamps and acknowledges a delivered message and refuses a
 * send once the match has ended (issue #21). What it cannot do is decide how a
 * *sender* should treat a message that is still in flight, that failed but could
 * still be resent, or that can never be delivered — that is a UI concern and
 * lives here.
 *
 * The module is deliberately a pure, framework-agnostic state machine: no React,
 * no sockets, no timers. A realtime layer drives it — {@link
 * OutgoingMessageTracker.queue} on optimistic send, {@link
 * OutgoingMessageTracker.ack} on the server `chat:ack`, {@link
 * OutgoingMessageTracker.fail} on a `chat:send-failed` or a client-side
 * ack-timeout, {@link OutgoingMessageTracker.endMatch} on `match:ended` — and a
 * chat view renders {@link OutgoingMessage.status}. Keeping it pure makes the two
 * guardrails the slice exists for fully unit-testable without a socket server.
 */

/**
 * Where an outgoing message is in its lifecycle, from the sender's perspective:
 *
 * - `sending` — optimistically rendered, awaiting the server's acknowledgement.
 * - `sent` — the server acknowledged delivery (story 39); terminal success. The
 *   MVP has no read receipts (story 41), so this is *delivered to the server*,
 *   never "read".
 * - `failed` — the send did not succeed but the match is still valid, so it is
 *   **retryable** (story 42). The only status {@link
 *   OutgoingMessageTracker.retry} acts on.
 * - `undelivered` — terminal: the match ended before the message was delivered,
 *   so it will never be sent and **must not be retried** (story 43).
 * - `rejected` — terminal: the server refused the message as malformed (empty or
 *   over the length bound). Retrying the same text cannot help — the sender must
 *   edit and send anew — so it is not offered a retry, and unlike `undelivered`
 *   it does not imply the match is over.
 */
export type OutgoingMessageStatus =
  | "sending"
  | "sent"
  | "failed"
  | "undelivered"
  | "rejected";

/**
 * Why a send failed, as reported to {@link OutgoingMessageTracker.fail}. Three of
 * these mirror the server's `chat:send-failed` reasons exactly (`match_ended`,
 * `empty`, `too_long`) so the realtime layer can forward the payload verbatim;
 * `timeout` is the client-only case where no acknowledgement arrived in time (a
 * dropped socket or a slow network) — the temporary delivery issue story 42 is
 * about, and the one that yields a retryable `failed` rather than a terminal
 * state.
 */
export type SendFailureReason = "timeout" | "match_ended" | "empty" | "too_long";

/** One outgoing message tracked through its lifecycle. */
export interface OutgoingMessage {
  /**
   * The client-minted correlation id the realtime layer sends as
   * `clientMessageId` and the server echoes back on ack/fail — the handle that
   * ties a server response to the optimistic bubble already on screen.
   */
  clientMessageId: string;
  /**
   * The message text, retained so a `failed` message can be resent with the
   * identical body on {@link OutgoingMessageTracker.retry} without the caller
   * having to stash it elsewhere.
   */
  text: string;
  status: OutgoingMessageStatus;
  /**
   * The reason a message reached `failed`/`undelivered`/`rejected`, for messaging
   * ("couldn't send — tap to retry" vs. "this chat ended"). Null while `sending`
   * or once `sent`.
   */
  failureReason: SendFailureReason | null;
}

/**
 * Tracks the sender's outgoing messages for a single match and enforces the two
 * guardrails of issue #23:
 *
 *   - **Retry while valid (story 42):** a send that times out is marked `failed`
 *     and {@link canRetry} reports it as retryable, so the UI can offer a retry
 *     that re-emits the same text.
 *   - **Stop after the match ends (story 43):** once {@link endMatch} fires (or a
 *     send is refused as `match_ended`), every still-pending or failed message
 *     becomes terminal `undelivered`, {@link retry} on it is a no-op, and any
 *     further {@link queue} is born `undelivered` — so nothing is ever delivered
 *     out of context, even if the UI tries.
 *
 * One tracker instance is scoped to one match; a new match starts a new tracker
 * (matching the API's match-scoped, ephemeral state — issue #21, story 46).
 */
export class OutgoingMessageTracker {
  private readonly messages = new Map<string, OutgoingMessage>();

  /**
   * True once the match this tracker belongs to has ended. Latched by {@link
   * endMatch} and by a `match_ended` failure; it makes the story-43 guard
   * absorbing — no message can leave a terminal `undelivered` state afterward.
   */
  private ended = false;

  /**
   * Begin tracking an optimistically-sent message (or re-arm one being retried).
   * Returns the message so the caller can render it immediately. If the match has
   * already ended, the message is recorded as terminal `undelivered` instead of
   * `sending`: the composer should already be disabled, but the guard makes a
   * stray send after match end impossible to put back in flight (story 43).
   */
  queue(clientMessageId: string, text: string): OutgoingMessage {
    const message: OutgoingMessage = this.ended
      ? { clientMessageId, text, status: "undelivered", failureReason: "match_ended" }
      : { clientMessageId, text, status: "sending", failureReason: null };
    this.messages.set(clientMessageId, message);
    return message;
  }

  /**
   * Acknowledge a delivered message (server `chat:ack`): `sending` → `sent`. A
   * late ack that arrives after the message was already failed or the match ended
   * is ignored — a message marked `undelivered` (story 43) must stay terminal, so
   * acks only ever clear the pending state, never resurrect a settled one.
   */
  ack(clientMessageId: string): void {
    const message = this.messages.get(clientMessageId);
    if (message?.status === "sending") {
      message.status = "sent";
      message.failureReason = null;
    }
  }

  /**
   * Record a failed send and move the message to the right terminal-or-retryable
   * state by reason:
   *
   *   - `timeout` while the match is valid → `failed` (retryable, story 42).
   *   - `match_ended` → the match is over, so this message *and every other
   *     still-pending one* become `undelivered` and the tracker latches ended
   *     (story 43).
   *   - any failure once the match has ended → `undelivered`, never `failed`, so
   *     a stale timeout can't reopen a retry after the chat is gone (story 43).
   *   - `empty` / `too_long` → `rejected` (terminal; the text must be edited, so
   *     no retry is offered, but the match may still be live).
   *
   * An already-`sent` message is left untouched — a spurious late failure cannot
   * undo a confirmed delivery.
   */
  fail(clientMessageId: string, reason: SendFailureReason): void {
    if (reason === "match_ended") {
      // The match is over: settle this message and all others uniformly.
      this.endMatch();
      return;
    }

    const message = this.messages.get(clientMessageId);
    if (!message || message.status === "sent") {
      return;
    }

    if (this.ended) {
      message.status = "undelivered";
      message.failureReason = "match_ended";
      return;
    }

    if (reason === "timeout") {
      message.status = "failed";
    } else {
      // empty / too_long: malformed, so retrying the same text is pointless.
      message.status = "rejected";
    }
    message.failureReason = reason;
  }

  /**
   * Re-arm a `failed` message for another send attempt: `failed` → `sending`,
   * returning it so the caller can re-emit the same text under the same
   * correlation id. Returns null for anything not currently `failed` — in
   * particular an `undelivered` message after the match ended, which is the
   * story-43 stop: a retry can never put a post-match message back in flight.
   */
  retry(clientMessageId: string): OutgoingMessage | null {
    const message = this.messages.get(clientMessageId);
    if (!message || message.status !== "failed") {
      return null;
    }
    message.status = "sending";
    message.failureReason = null;
    return message;
  }

  /**
   * Settle the match: latch the ended flag and move every still-in-flight
   * (`sending`) or retryable (`failed`) message to terminal `undelivered` (story
   * 43). Already-terminal messages (`sent`, `rejected`, prior `undelivered`) are
   * left as they are — a delivered message stays delivered, and a validation
   * rejection keeps its more specific reason. Idempotent, so a `match:ended`
   * event racing a disconnect can fire it twice harmlessly.
   */
  endMatch(): void {
    this.ended = true;
    for (const message of this.messages.values()) {
      if (message.status === "sending" || message.status === "failed") {
        message.status = "undelivered";
        message.failureReason = "match_ended";
      }
    }
  }

  /** Whether a retry is allowed for this message — true only while `failed`. */
  canRetry(clientMessageId: string): boolean {
    return this.messages.get(clientMessageId)?.status === "failed";
  }

  /** The tracked message for a correlation id, or undefined if unknown. */
  get(clientMessageId: string): OutgoingMessage | undefined {
    const message = this.messages.get(clientMessageId);
    return message ? { ...message } : undefined;
  }

  /** Every tracked message in insertion (send) order, as a snapshot copy. */
  list(): OutgoingMessage[] {
    return Array.from(this.messages.values(), (message) => ({ ...message }));
  }
}
