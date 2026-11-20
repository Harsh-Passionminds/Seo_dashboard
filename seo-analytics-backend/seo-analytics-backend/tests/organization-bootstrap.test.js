import assert from "node:assert/strict";
import test from "node:test";
import { ensureBootstrapAdminMembership } from "../src/services/organization-bootstrap.service.js";

test("bootstrap Google Admin is granted active membership in the shared organization", async () => {
  const statements = [];
  const db = {
    async execute(sql, params) {
      statements.push({ sql, params });
      if (sql.startsWith("SELECT organization_id")) {
        return [[{ organization_id: 7 }]];
      }
      return [{ affectedRows: 1 }];
    }
  };

  await ensureBootstrapAdminMembership(db, 23);

  assert.match(statements[1].sql, /INSERT INTO organization_members/);
  assert.match(statements[1].sql, /role = 'admin', status = 'active'/);
  assert.deepEqual(statements[1].params, [7, 23]);
});

test("bootstrap fails explicitly if migrations have not created an active organization", async () => {
  const db = { async execute() { return [[]]; } };

  await assert.rejects(
    ensureBootstrapAdminMembership(db, 23),
    /active shared-default organization was not found/
  );
});
