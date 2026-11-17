import assert from "node:assert/strict";
import test from "node:test";
import { createAdminService } from "../src/services/admin.service.js";
import { requireRole } from "../src/middleware/auth.js";

function createTransactionDb(execute) {
  const statements = [];
  let rolledBack = false;
  let committed = false;
  let released = false;
  const connection = {
    async beginTransaction() {},
    async execute(sql, params) {
      statements.push(sql.replace(/\s+/g, " ").trim());
      return execute(sql.replace(/\s+/g, " ").trim(), params);
    },
    async query(sql, params) {
      return this.execute(sql, params);
    },
    async commit() {
      committed = true;
    },
    async rollback() {
      rolledBack = true;
    },
    release() {
      released = true;
    }
  };
  return {
    db: {
      async getConnection() {
        return connection;
      },
      async execute(sql, params) {
        return connection.execute(sql, params);
      }
    },
    statements,
    wasRolledBack: () => rolledBack,
    wasCommitted: () => committed,
    wasReleased: () => released
  };
}

test("last active Admin cannot be demoted", async () => {
  const transaction = createTransactionDb((sql) => {
    if (sql.startsWith("SELECT user_id FROM employee_credentials")) return [[]];
    if (sql.startsWith("SELECT m.user_id")) {
      return [[{ user_id: 7, role: "admin", status: "active" }]];
    }
    if (sql.startsWith("SELECT user_id FROM organization_members")) {
      return [[{ user_id: 7 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createAdminService({ db: transaction.db });

  await assert.rejects(
    service.changeMemberRole(3, 7, 7, "viewer"),
    (error) => error.status === 409 && error.code === "LAST_ACTIVE_ADMIN"
  );
  assert.equal(transaction.wasRolledBack(), true);
  assert.equal(transaction.wasCommitted(), false);
  assert.equal(transaction.wasReleased(), true);
  assert.equal(transaction.statements.some((sql) => sql.startsWith("UPDATE organization_members")), false);
});

test("invitation acceptance refuses a second active organization membership", async () => {
  const invitation = {
    invitation_id: 12,
    organization_id: 3,
    role: "admin",
    status: "pending",
    expires_at: "2026-02-02T00:00:00.000Z",
    organization_status: "active",
    email_normalized: "employee@example.com"
  };
  const transaction = createTransactionDb((sql) => {
    if (sql.startsWith("SELECT i.*")) return [[invitation]];
    if (sql.startsWith("SELECT status FROM organization_members")) return [[]];
    if (sql.startsWith("SELECT organization_id FROM organization_members")) {
      return [[{ organization_id: 9 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createAdminService({
    db: transaction.db,
    now: () => new Date("2026-02-01T00:00:00.000Z")
  });

  await assert.rejects(
    service.acceptInvitation({ user_id: 21, email: "employee@example.com" }, "x".repeat(32)),
    (error) => error.status === 409 && error.code === "ORGANIZATION_MEMBERSHIP_EXISTS"
  );
  assert.equal(transaction.wasRolledBack(), true);
  assert.equal(transaction.statements.some((sql) => sql.startsWith("INSERT INTO organization_members")), false);
});

test("invitation creation fails explicitly when SMTP is not configured", async () => {
  let queryCount = 0;
  const service = createAdminService({
    db: {
      async execute() {
        queryCount += 1;
        return [[]];
      }
    },
    isSmtpConfigured: () => false
  });

  await assert.rejects(
    service.createInvitation(3, 7, {
      email: "employee@example.com",
      role: "admin",
      websiteIds: []
    }),
    (error) => error.status === 503 && error.code === "EMAIL_NOT_CONFIGURED"
  );
  assert.equal(queryCount, 0);
});

test("Admin creates a password-hashed Analyst account with multiple website grants", async () => {
  let credentialParams;
  const memberRow = {
    user_id: 21,
    display_name: "Analyst One",
    email: null,
    username: "analyst.one",
    last_login_at: null,
    role: "analyst",
    status: "active",
    joined_at: new Date(),
    assigned_website_ids: "4,5"
  };
  const transaction = createTransactionDb((sql, params) => {
    if (sql.startsWith("SELECT website_id FROM website_credentials")) {
      return [[{ website_id: 4 }, { website_id: 5 }]];
    }
    if (sql.startsWith("INSERT INTO users")) return [{ insertId: 21 }];
    if (sql.startsWith("INSERT INTO organization_members")) return [{ affectedRows: 1 }];
    if (sql.startsWith("INSERT INTO employee_credentials")) {
      credentialParams = params;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO website_permissions")) return [{ affectedRows: 1 }];
    if (sql.startsWith("INSERT INTO activity_logs")) return [{ affectedRows: 1 }];
    if (sql.startsWith("SELECT u.user_id, u.display_name")) return [[memberRow]];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const service = createAdminService({ db: transaction.db });

  const result = await service.createEmployee(3, 7, {
    name: "Analyst One",
    username: "Analyst.One",
    password: "a-long-and-secure-password",
    role: "analyst",
    websiteIds: [4, 5]
  });

  assert.equal(result.username, "analyst.one");
  assert.equal(result.role, "analyst");
  assert.deepEqual(result.assignedWebsiteIds, [4, 5]);
  assert.equal("passwordHash" in result, false);
  assert.notEqual(credentialParams[3], "a-long-and-secure-password");
  assert.equal(transaction.statements.filter((sql) => sql.startsWith("INSERT INTO website_permissions")).length, 2);
  assert.equal(transaction.wasCommitted(), true);
});

test("invitation delivery logs useful redacted diagnostics", async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const invitationRow = {
    invitation_id: 12,
    email: "employee@example.com",
    role: "admin",
    status: "pending",
    delivery_status: "queued",
    expires_at: future,
    invited_by_user_id: 7,
    accepted_by_user_id: null,
    accepted_at: null,
    created_at: new Date()
  };
  const transaction = createTransactionDb((sql) => {
    if (sql.startsWith("SELECT m.status FROM organization_members")) return [[]];
    if (sql.startsWith("SELECT invitation_id FROM organization_invitations")) return [[]];
    if (sql.startsWith("SELECT invitation_expiry_hours FROM organizations")) {
      return [[{ invitation_expiry_hours: 24 }]];
    }
    if (sql.startsWith("INSERT INTO organization_invitations")) return [{ insertId: 12 }];
    if (sql.startsWith("SELECT invitation_id, email, role")) return [[invitationRow]];
    if (sql.startsWith("SELECT GROUP_CONCAT")) return [[{ ids: null }]];
    if (sql.startsWith("SELECT organization_id, organization_name")) {
      return [[{ organization_name: "Example organization" }]];
    }
    if (sql.startsWith("INSERT INTO activity_logs")) return [{ affectedRows: 1 }];
    if (sql.startsWith("UPDATE organization_invitations")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  let diagnostic;
  const service = createAdminService({
    db: transaction.db,
    isSmtpConfigured: () => true,
    deliverInvitation: async () => {
      throw new Error("SMTP rejected employee@example.com token=topsecret https://example.com/private");
    },
    logDeliveryFailure: (value) => {
      diagnostic = value;
    }
  });

  const result = await service.createInvitation(3, 7, {
    email: "employee@example.com",
    role: "admin",
    websiteIds: []
  });

  assert.equal(result.deliveryStatus, "failed");
  assert.equal(diagnostic.code, "UNKNOWN");
  assert.equal(diagnostic.responseCode, null);
  assert.equal(diagnostic.name, "Error", diagnostic.message);
  assert.match(diagnostic.message, /token=\[redacted\]/);
  assert.doesNotMatch(diagnostic.message, /employee@example\.com|topsecret|https:/);
});

test("Admin routes reject viewers and allow Admin members", () => {
  const middleware = requireRole("admin");
  let viewerError;
  middleware({ membership: { role: "viewer" } }, {}, (error) => {
    viewerError = error;
  });
  assert.equal(viewerError.status, 403);
  assert.equal(viewerError.code, "FORBIDDEN");

  let adminError;
  middleware({ membership: { role: "admin" } }, {}, (error) => {
    adminError = error;
  });
  assert.equal(adminError, undefined);
});
