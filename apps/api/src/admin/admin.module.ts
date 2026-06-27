import { Module } from "@nestjs/common";
import { ADMIN_ALLOWLIST_ENV, parseAdminAllowlist } from "@fahhhchat/config";
import { AuthModule } from "../auth/auth.module";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";
import { ADMIN_ALLOWLIST, ADMIN_STORE, type AdminStore } from "./admin.types";
import { InMemoryAdminStore } from "./in-memory-admin.store";

/**
 * Durable admin grants belong in Postgres per the PRD; until that store lands, an
 * in-memory implementation keeps the admin-auth slice demoable and unit-testable.
 */
function createAdminStore(): AdminStore {
  return new InMemoryAdminStore();
}

/**
 * Resolve the initial-admin allowlist from the environment (story 83) so launch
 * access is config-driven, not hard-coded. Set `ADMIN_ALLOWLIST` to a
 * comma-separated list of Google emails; the parser normalizes and de-duplicates.
 */
function createAdminAllowlist(): string[] {
  return parseAdminAllowlist(process.env[ADMIN_ALLOWLIST_ENV]);
}

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminGuard,
    { provide: ADMIN_STORE, useFactory: createAdminStore },
    { provide: ADMIN_ALLOWLIST, useFactory: createAdminAllowlist }
  ],
  exports: [AdminService, AdminGuard]
})
export class AdminModule {}
