import assert from "node:assert/strict";
import test from "node:test";
import { canGoogleAuthenticateAsAdmin } from "../src/services/auth-policy.service.js";
import { createEmployeeAuthService } from "../src/services/employee-auth.service.js";
import { assertPassword, hashPassword, verifyPassword } from "../src/services/password.service.js";

test("Google authentication is limited to active Admins and Admin invitations", () => {
  assert.equal(canGoogleAuthenticateAsAdmin({
    memberships: [{ role: "admin", status: "active" }]
  }), true);
  assert.equal(canGoogleAuthenticateAsAdmin({
    memberships: [{ role: "analyst", status: "active" }],
    pendingAdminInvitation: true
  }), false);
  assert.equal(canGoogleAuthenticateAsAdmin({
    memberships: [],
    pendingAdminInvitation: true
  }), true);
  assert.equal(canGoogleAuthenticateAsAdmin({
    memberships: [],
    bootstrapAdmin: true
  }), true);
  assert.equal(canGoogleAuthenticateAsAdmin({ memberships: [] }), false);
});

test("Analyst and Viewer username/password logins verify bcrypt hashes and record last login", async () => {
  const password = "a-long-and-secure-password";
  const passwordHash = await hashPassword(password);
  let account = null;
  const updates = [];
  const service = createEmployeeAuthService({
    db: {
      async execute(sql) {
        if (sql.startsWith("SELECT u.user_id")) return [[{ ...account, password_hash: passwordHash }]];
        if (sql.startsWith("UPDATE employee_credentials SET last_login_at")) {
          updates.push(sql);
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    },
    now: () => new Date("2026-11-17T00:00:00.000Z")
  });

  for (const role of ["analyst", "viewer"]) {
    account = {
      user_id: role === "analyst" ? 11 : 12,
      role,
      membership_status: "active",
      organization_status: "active",
      organization_id: 3,
      username: role,
      must_change_password: 0
    };
    const user = await service.login(role.toUpperCase(), password);
    assert.equal(user.role, role);
  }
  assert.equal(updates.length, 2);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("incorrect-password", passwordHash), false);
});

test("invalid and disabled employee credentials use the same generic login error", async () => {
  const passwordHash = await hashPassword("a-long-and-secure-password");
  let account = null;
  const service = createEmployeeAuthService({
    db: {
      async execute(sql) {
        if (sql.startsWith("SELECT u.user_id")) return [account ? [{ ...account, password_hash: passwordHash }] : []];
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }
  });
  const errors = [];
  for (const state of [
    null,
    {
      role: "analyst",
      membership_status: "inactive",
      organization_status: "active"
    }
  ]) {
    account = state;
    await assert.rejects(service.login("staff", "a-long-and-secure-password"), (error) => {
      errors.push({ status: error.status, code: error.code, message: error.message });
      return error.status === 401 && error.code === "INVALID_CREDENTIALS";
    });
  }
  assert.deepEqual(errors[0], errors[1]);
});

test("password policy rejects weak credentials", () => {
  assert.throws(() => assertPassword("short"), { code: "VALIDATION_ERROR" });
  assert.throws(() => assertPassword("é".repeat(37)), { code: "VALIDATION_ERROR" });
  assert.doesNotThrow(() => assertPassword("a-long-and-secure-password"));
});

test("temporary password change stores only a hash and advances session version", async () => {
  const statements = [];
  const service = createEmployeeAuthService({
    db: {
      async execute(sql, params) {
        statements.push({ sql, params });
        if (sql.startsWith("UPDATE employee_credentials")) return [{ affectedRows: 1 }];
        if (sql.startsWith("UPDATE users")) return [{ affectedRows: 1 }];
        if (sql.startsWith("SELECT user_id")) return [[{ user_id: 11, email: null, session_version: 2 }]];
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }
  });
  const user = await service.changeTemporaryPassword(11, "a-new-and-secure-password");

  assert.equal(user.session_version, 2);
  assert.equal(statements[0].params[0].includes("a-new-and-secure-password"), false);
  assert.equal(await verifyPassword("a-new-and-secure-password", statements[0].params[0]), true);
  assert.match(statements[0].sql, /must_change_password = FALSE/);
});
