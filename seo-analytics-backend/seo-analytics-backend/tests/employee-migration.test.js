import assert from "node:assert/strict";
import test from "node:test";
import { down, up } from "../migrations/015_employee_password_accounts.js";

test("employee credential migration allows nullable Google identity and creates constrained account storage", async () => {
  const statements = [];
  const pool = {
    async execute() {
      return [[{ present: 1 }]];
    },
    async query(sql) {
      statements.push(sql);
      if (sql.includes("FROM organization_members m")) return [[]];
      return [[]];
    }
  };
  await up({ pool });
  assert.equal(statements.some((sql) => sql.includes("MODIFY google_sub VARCHAR(255) NULL")), true);
  assert.equal(statements.some((sql) => sql.includes("MODIFY email VARCHAR(320) NULL")), true);
  const createTable = statements.find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS employee_credentials"));
  assert.match(createTable, /password_hash VARCHAR\(255\)/);
  assert.match(createTable, /must_change_password BOOLEAN/);
  assert.match(createTable, /UNIQUE KEY uq_employee_username \(username\)/);
  assert.match(createTable, /FOREIGN KEY \(organization_id, user_id\)/);
  assert.equal(statements.some((sql) => sql.includes("SET u.session_version = u.session_version + 1")), true);
  assert.equal(statements.some((sql) => sql.includes("SET t.is_active = FALSE")), true);
});

test("employee credential migration refuses rollback while accounts exist", async () => {
  const pool = {
    async query() {
      return [[{ count: 1 }]];
    }
  };
  await assert.rejects(down({ pool }), /employee accounts exist/);
});
