import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
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
 */
@Module({
  imports: [AuthModule, SessionModule],
  providers: [
    ChatService,
    ChatGateway,
    { provide: CHAT_STORE, useFactory: createChatStore },
    { provide: DISPLAY_NAME_RESOLVER, useClass: IdentityDisplayNameResolver },
  ],
  exports: [ChatService],
})
export class ChatModule {}
