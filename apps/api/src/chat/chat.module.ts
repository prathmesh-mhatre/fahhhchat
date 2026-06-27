import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RateLimitModule } from "../rate-limit/rate-limit.module";
import { RematchModule } from "../rematch/rematch.module";
import { SessionModule } from "../session/session.module";
import { ChatGateway } from "./chat.gateway";
import { ChatService } from "./chat.service";
import {
  CHAT_STORE,
  DISPLAY_NAME_RESOLVER,
  type ChatStore,
} from "./chat.types";
import { IdentityDisplayNameResolver } from "./identity-display-name.resolver";
import { InMemoryChatStore } from "./in-memory-chat.store";

/**
 * Selects the active-match/buffer store from the environment: Redis when
 * `REDIS_URL` is set (production / integration), otherwise an in-memory store for
 * local dev and tests. ioredis is required lazily so the in-memory path needs no
 * Redis client, mirroring the seam used by sessions, rate limits, and the
 * matching queue.
 */
function createChatStore(): ChatStore {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new InMemoryChatStore();
  }
  const { Redis } = require("ioredis") as typeof import("ioredis");
  const { RedisChatStore } =
    require("./redis-chat.store") as typeof import("./redis-chat.store");
  return new RedisChatStore(new Redis(redisUrl));
}

/**
 * Realtime in-match text chat (issue #21). Owns the {@link ChatService} (match
 * routing + the ephemeral buffer) and the {@link ChatGateway} (the Socket.IO
 * surface). The gateway shares the Socket.IO server stood up by the realtime
 * slice; no extra wiring is needed because Nest attaches every gateway on the
 * same port to one server. {@link ChatService} is exported so the matchmaking
 * gateway can register a match the instant a pair is created.
 *
 * Imports {@link AuthModule} and {@link SessionModule} so the
 * {@link IdentityDisplayNameResolver} can read each matched user's generated
 * display name (logged-in account or guest session) for typing indicators (issue
 * #22, story 40) — captured once at match registration, never client-asserted.
 * Imports {@link RateLimitModule} so {@link ChatService} can meter URL-bearing
 * messages against the per-identity `chat_link` budget for link-spam control
 * (issue #24, story 45). Imports {@link RematchModule} so {@link ChatService} can
 * record a rematch-prevention block when a user reports-with-block or blocks the
 * stranger they were chatting with (issue #27, stories 53-54).
 */
@Module({
  imports: [AuthModule, SessionModule, RateLimitModule, RematchModule],
  providers: [
    ChatService,
    ChatGateway,
    { provide: CHAT_STORE, useFactory: createChatStore },
    { provide: DISPLAY_NAME_RESOLVER, useClass: IdentityDisplayNameResolver },
  ],
  exports: [ChatService],
})
export class ChatModule {}
