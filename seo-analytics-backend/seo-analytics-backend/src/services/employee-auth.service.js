import { HttpError } from "../utils/http-error.js";
import { hashPassword, verifyPassword } from "./password.service.js";

let dummyPasswordHash;

export function createEmployeeAuthService({ db, now = () => new Date() }) {
  async function login(username, password) {
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    const submittedPassword = typeof password === "string" ? password : "";
    const [rows] = normalizedUsername
      ? await db.execute(
          `SELECT u.user_id, u.email, u.display_name, u.session_version,
                  ec.password_hash, ec.must_change_password, ec.username,
                  m.role, m.status AS membership_status, o.status AS organization_status,
                  ec.organization_id
           FROM employee_credentials ec
           JOIN users u ON u.user_id = ec.user_id
           JOIN organization_members m
             ON m.organization_id = ec.organization_id AND m.user_id = ec.user_id
           JOIN organizations o ON o.organization_id = ec.organization_id
           WHERE ec.username = ? LIMIT 2`,
          [normalizedUsername]
        )
      : [[]];
    const account = rows.length === 1 ? rows[0] : null;
    const hash = account?.password_hash || (dummyPasswordHash ||= await hashPassword("not-a-real-account-password"));
    const passwordMatches = await verifyPassword(submittedPassword, hash);
    if (
      !account || !passwordMatches || account.membership_status !== "active" ||
      account.organization_status !== "active" || !["analyst", "viewer"].includes(account.role)
    ) {
      throw new HttpError(401, "Invalid username or password.", "INVALID_CREDENTIALS");
    }

    await db.execute(
      "UPDATE employee_credentials SET last_login_at = ? WHERE organization_id = ? AND user_id = ?",
      [now(), account.organization_id, account.user_id]
    );
    return account;
  }

  async function changeTemporaryPassword(userId, password) {
    const passwordHash = await hashPassword(password);
    const [result] = await db.execute(
      `UPDATE employee_credentials
       SET password_hash = ?, must_change_password = FALSE
       WHERE user_id = ? AND must_change_password = TRUE`,
      [passwordHash, userId]
    );
    if (!result.affectedRows) {
      throw new HttpError(409, "No temporary password change is pending.", "PASSWORD_CHANGE_NOT_REQUIRED");
    }
    await db.execute("UPDATE users SET session_version = session_version + 1 WHERE user_id = ?", [userId]);
    const [rows] = await db.execute(
      "SELECT user_id, email, session_version FROM users WHERE user_id = ? LIMIT 1",
      [userId]
    );
    return rows[0];
  }

  return { login, changeTemporaryPassword };
}
