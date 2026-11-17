export function canGoogleAuthenticateAsAdmin({ memberships, pendingAdminInvitation, bootstrapAdmin }) {
  if (memberships.some((membership) => membership.status === "active" && membership.role !== "admin")) {
    return false;
  }
  return Boolean(memberships.some((membership) => membership.status === "active" && membership.role === "admin") ||
    pendingAdminInvitation ||
    bootstrapAdmin);
}
