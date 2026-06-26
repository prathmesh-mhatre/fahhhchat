import type { Redis } from "ioredis";
import type {
  MatchCriteria,
  MatchmakingQueue,
  QueuedParticipant,
} from "./matchmaking.types";

const ORDER_KEY = "matchmaking:order";
const PARTICIPANTS_KEY = "matchmaking:participants";

/**
 * Atomically pop the best partner under staged language relaxation (story 36).
 * Pairing has to be a single atomic step so two simultaneous joiners can never
 * both claim the same waiting partner, which a read-then-remove from the API
 * would allow — hence the whole tiered decision runs here in Lua.
 *
 * Walking the order list head-first (oldest-first), it returns the first
 * same-language waiter; failing that, the oldest waiter past the relaxation
 * window (cross-language). A different-language waiter still inside its window is
 * left in place. Returns the participant JSON, or a Lua `false` (→ null in
 * ioredis) when nobody suitable waits.
 *
 * KEYS[1]=order list (head = oldest), KEYS[2]=participants hash.
 * ARGV: [1]=excludeKey, [2]=language, [3]=now (ms), [4]=relaxAfterMs.
 */
const TAKE_MATCH = `
local order = KEYS[1]
local participants = KEYS[2]
local exclude = ARGV[1]
local language = ARGV[2]
local now = tonumber(ARGV[3])
local relaxAfter = tonumber(ARGV[4])
local len = redis.call('LLEN', order)
local relaxedKey = false
for i = 0, len - 1 do
  local key = redis.call('LINDEX', order, i)
  if key ~= exclude then
    local data = redis.call('HGET', participants, key)
    if data then
      local p = cjson.decode(data)
      if p.language == language then
        redis.call('LREM', order, 1, key)
        redis.call('HDEL', participants, key)
        return data
      end
      if relaxedKey == false and (now - p.enqueuedAt) >= relaxAfter then
        relaxedKey = key
      end
    end
  end
end
if relaxedKey ~= false then
  local data = redis.call('HGET', participants, relaxedKey)
  redis.call('LREM', order, 1, relaxedKey)
  redis.call('HDEL', participants, relaxedKey)
  return data
end
return false
`;

/**
 * Redis-backed shared matching pool, matching the PRD decision to keep
 * matchmaking queues in Redis. A list (`matchmaking:order`) holds identity keys
 * oldest-first for FIFO pairing; a hash (`matchmaking:participants`) holds the
 * full participant record per key. The pair step runs as a Lua script so it is
 * atomic across concurrent joiners. State is intentionally not TTL'd here —
 * entries are removed on match, leave, or disconnect; the gateway owns cleanup.
 */
export class RedisMatchmakingQueue implements MatchmakingQueue {
  constructor(private readonly redis: Redis) {}

  async enqueue(participant: QueuedParticipant): Promise<boolean> {
    const key = this.keyOf(participant);
    const existed = await this.redis.hexists(PARTICIPANTS_KEY, key);
    // LREM clears any stale position so a reconnect lands at the tail exactly
    // once; RPUSH appends to the tail so the head stays the oldest waiter.
    await this.redis
      .multi()
      .lrem(ORDER_KEY, 0, key)
      .rpush(ORDER_KEY, key)
      .hset(PARTICIPANTS_KEY, key, JSON.stringify(participant))
      .exec();
    return existed === 0;
  }

  async remove(key: string): Promise<boolean> {
    const [, removed] = (await this.redis
      .multi()
      .lrem(ORDER_KEY, 0, key)
      .hdel(PARTICIPANTS_KEY, key)
      .exec()) as Array<[Error | null, number]>;
    return (removed?.[1] ?? 0) > 0;
  }

  async contains(key: string): Promise<boolean> {
    return (await this.redis.hexists(PARTICIPANTS_KEY, key)) === 1;
  }

  async takeMatch(criteria: MatchCriteria): Promise<QueuedParticipant | null> {
    const data = (await this.redis.eval(
      TAKE_MATCH,
      2,
      ORDER_KEY,
      PARTICIPANTS_KEY,
      criteria.excludeKey,
      criteria.language,
      String(criteria.now),
      String(criteria.relaxAfterMs)
    )) as string | null;
    return data ? (JSON.parse(data) as QueuedParticipant) : null;
  }

  async removeBySocket(socketId: string): Promise<string | null> {
    // The queue is small (it drains as fast as pairs form), so scanning the
    // participant hash to find the one socket is cheaper than maintaining a
    // second reverse index that has to stay consistent with it.
    const all = await this.redis.hgetall(PARTICIPANTS_KEY);
    for (const [key, raw] of Object.entries(all)) {
      const participant = JSON.parse(raw) as QueuedParticipant;
      if (participant.socketId === socketId) {
        await this.remove(key);
        return key;
      }
    }
    return null;
  }

  async size(): Promise<number> {
    return this.redis.hlen(PARTICIPANTS_KEY);
  }

  private keyOf(participant: QueuedParticipant): string {
    return `${participant.identity.kind}:${participant.identity.id}`;
  }
}
