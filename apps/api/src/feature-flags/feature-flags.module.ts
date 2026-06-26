import { Module } from "@nestjs/common";
import { isFeatureFlagKey, type FeatureFlagKey } from "@fahhhchat/config";
import { FeatureFlagsController } from "./feature-flags.controller";
import { FeatureFlagsService } from "./feature-flags.service";
import { FeatureFlagGuard } from "./require-feature-flag.guard";
import { InMemoryFeatureFlagStore } from "./in-memory-feature-flag.store";
import { InMemoryFeatureFlagAuditLog } from "./in-memory-feature-flag-audit.log";
import {
  FEATURE_FLAG_AUDIT_LOG,
  FEATURE_FLAG_STORE,
  type FeatureFlagAuditLog,
  type FeatureFlagStore
} from "./feature-flags.types";

/**
 * Parse the boot-time kill-switch override: a comma-separated list of flag keys
 * to start *disabled* (e.g. `FEATURE_FLAGS_DISABLED=camera_media,queue_entry`).
 * This lets an operator launch with a risky surface already off, and makes the
 * switches demoable in local dev before the admin management slice (#37) exists.
 * Unknown keys are ignored so a typo can't crash boot.
 */
function disabledFromEnv(): FeatureFlagKey[] {
  const raw = process.env.FEATURE_FLAGS_DISABLED;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((key) => key.trim())
    .filter((key): key is FeatureFlagKey => isFeatureFlagKey(key));
}

/**
 * Database-backed feature flags / launch kill switches (issue #15). The durable
 * store belongs in Postgres per the PRD; until that lands an in-memory store
 * (seeded from {@link disabledFromEnv}) keeps the slice demoable and testable,
 * selected behind the {@link FEATURE_FLAG_STORE} seam like the session/user
 * stores. {@link FeatureFlagsService} and {@link FeatureFlagGuard} are exported
 * so other modules can gate their surfaces (guest access, queue entry, gender
 * filters) on the shared, cached evaluation.
 */
function createFeatureFlagStore(): FeatureFlagStore {
  // A Postgres-backed store drops in here later (selected on DATABASE_URL),
  // mirroring how SESSION_STORE selects Redis when REDIS_URL is set.
  return new InMemoryFeatureFlagStore(disabledFromEnv());
}

function createFeatureFlagAuditLog(): FeatureFlagAuditLog {
  // A Postgres-backed audit log drops in here later (selected on DATABASE_URL).
  return new InMemoryFeatureFlagAuditLog();
}

@Module({
  controllers: [FeatureFlagsController],
  providers: [
    FeatureFlagsService,
    FeatureFlagGuard,
    { provide: FEATURE_FLAG_STORE, useFactory: createFeatureFlagStore },
    { provide: FEATURE_FLAG_AUDIT_LOG, useFactory: createFeatureFlagAuditLog }
  ],
  exports: [FeatureFlagsService, FeatureFlagGuard]
})
export class FeatureFlagsModule {}
