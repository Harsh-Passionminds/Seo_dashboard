import test from "node:test";
import assert from "node:assert/strict";
import { up } from "../migrations/010_create_organization_access.js";

test("organization migration requires a configured existing admin before schema changes", async () => {
  const statements = [];
  const mockPool = {
    async query(sql) {
      statements.push(sql);
      return [[
        { user_id: 1, email: "owner@example.com" },
        { user_id: 2, email: "viewer@example.com" }
      ]];
    }
  };

  await assert.rejects(
    up({ pool: mockPool, env: { ORGANIZATION_NAME: "Shared Organization" } }),
    /INITIAL_ORG_ADMIN_EMAIL/
  );
  assert.equal(statements.length, 1);
});

test("organization migration rejects an admin email that does not match an existing user before schema changes", async () => {
  const statements = [];
  const mockPool = {
    async query(sql) {
      statements.push(sql);
      return [[{ user_id: 1, email: "owner@example.com" }]];
    }
  };

  await assert.rejects(
    up({
      pool: mockPool,
      env: {
        ORGANIZATION_NAME: "Shared Organization",
        INITIAL_ORG_ADMIN_EMAIL: "missing@example.com"
      }
    }),
    /exactly one existing user/
  );
  assert.equal(statements.length, 1);
});
