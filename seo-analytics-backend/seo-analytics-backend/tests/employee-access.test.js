import assert from "node:assert/strict";
import test from "node:test";
import { createRequireWebsiteReportAccess } from "../src/middleware/reports-access.js";
import { requirePasswordChange, requireRole } from "../src/middleware/auth.js";

function requestFor(role = "analyst") {
  return {
    params: { websiteId: "9" },
    user: { user_id: 11 },
    organization: { organization_id: 3 },
    membership: { role }
  };
}

test("employee report access requires the current website grant", async () => {
  let grantActive = true;
  const db = {
    async execute(sql) {
      assert.match(sql, /p\.can_view = TRUE/);
      assert.match(sql, /p\.user_id IS NOT NULL/);
      return [grantActive ? [{ website_id: 9 }] : []];
    }
  };
  const middleware = createRequireWebsiteReportAccess(db);
  const req = requestFor("analyst");
  let error;
  await middleware(req, {}, (value) => { error = value; });
  assert.equal(error, undefined);
  assert.equal(req.website.website_id, 9);

  grantActive = false;
  error = undefined;
  await middleware(req, {}, (value) => { error = value; });
  assert.equal(error.code, "WEBSITE_NOT_FOUND");
});

test("Admin report access includes any active website in the organization", async () => {
  const db = {
    async execute(sql, params) {
      assert.match(sql, /AND TRUE/);
      assert.deepEqual(params, [11, 9, 3]);
      return [[{ website_id: 9 }]];
    }
  };
  let error;
  await createRequireWebsiteReportAccess(db)(requestFor("admin"), {}, (value) => { error = value; });
  assert.equal(error, undefined);
});

test("employee roles cannot access Admin APIs and temporary password sessions are gated", () => {
  let error;
  requireRole("admin")(requestFor("viewer"), {}, (value) => { error = value; });
  assert.equal(error.code, "FORBIDDEN");

  error = undefined;
  requirePasswordChange({ user: { must_change_password: true } }, {}, (value) => { error = value; });
  assert.equal(error.code, "PASSWORD_CHANGE_REQUIRED");
});
