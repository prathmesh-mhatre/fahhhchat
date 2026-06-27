import type { AdminRole } from "@fahhhchat/config";

/**
 * Durable grant of admin privileges to a Google identity (stories 82-83). Admin
 * status is *not* a flag on the public user summary — it is a separate record so
 * a general Google login carries no admin access by default and admin identity
 * (the Google email) never leaks into any client-facing payload.
 *
 * Keyed by the lower-cased Google email because that is what an operator
 * allowlists (story 83) and what a logged-in account already carries
 * (`UserRecord.email`). Durable admin records belong in PostgreSQL per the PRD
 * (admin configuration records); this slice ships the {@link AdminStore} contract
 * with an in-memory implementation so the guard is demoable and unit-testable,
 * and a Postgres-backed store can drop in later without touching the service.
 */
export interface AdminRecord {
  /** Lower-cased Google email this grant applies to. Internal use only. */
  email: string;
  /** The granted role. A record only ever exists for an actual admin. */
  role: AdminRole;
  /** How the grant was created: allowlist seed vs. an explicit later grant. */
  source: AdminGrantSource;
  createdAt: string;
}

/**
 * Provenance of an admin grant. `allowlist` marks the initial admins seeded from
 * {@link import("@fahhhchat/config").ADMIN_ALLOWLIST_ENV} on boot (story 83);
 * `manual` is reserved for grants an existing admin issues in a later slice. Kept
 * on the record so the audit trail can distinguish launch seeds from later edits.
 */
export type AdminGrantSource = "allowlist" | "manual";

/**
 * Persistence contract for admin grants. Mirrors the store seam already used for
 * users (`USER_STORE`) and feature flags (`FEATURE_FLAG_STORE`): an in-memory
 * implementation for dev/tests today, a Postgres-backed one later. Lookups are by
 * email because that is the allowlist key and the identity carried on a logged-in
 * account.
 */
export interface AdminStore {
  /** The admin grant for an email, or null when the email is not an admin. */
  findByEmail(email: string): Promise<AdminRecord | null>;
  /** Upsert an admin grant. Idempotent on email so re-seeding is safe. */
  save(record: AdminRecord): Promise<void>;
  /** All admin grants — used to seed idempotently and for ops listing. */
  list(): Promise<AdminRecord[]>;
}

export const ADMIN_STORE = Symbol("ADMIN_STORE");

/**
 * Injection token for the resolved initial-admin allowlist (a list of normalized
 * emails). Provided from {@link import("@fahhhchat/config").parseAdminAllowlist}
 * over the environment so the seed source is config-driven, not hard-coded.
 */
export const ADMIN_ALLOWLIST = Symbol("ADMIN_ALLOWLIST");

/**
 * The role-bearing identity of an authenticated admin, attached to the request by
 * {@link import("./admin.guard").AdminGuard} once both checks pass (valid Google
 * session AND an admin role). Carries the internal user id and the granted role;
 * the email is intentionally omitted so it never travels past the guard into a
 * handler's response shape.
 */
export interface AdminContext {
  userId: string;
  role: AdminRole;
}
