/**
 * Audit actions for administrator management. Metadata never contains
 * passwords, hashes, session tokens or raw invitation/reset tokens.
 */
export const ADMIN_AUDIT_ACTIONS = {
  ownerBootstrapped: "BOOTSTRAP_OWNER",
  invited: "INVITE_ADMIN",
  invitationRevoked: "REVOKE_ADMIN_INVITATION",
  invitationAccepted: "ACCEPT_ADMIN_INVITATION",
  deactivated: "DEACTIVATE_ADMIN",
  reactivated: "REACTIVATE_ADMIN",
} as const;

export const AUDIT_ENTITY_ADMIN_USER = "AdminUser";
export const AUDIT_ENTITY_ADMIN_INVITATION = "AdminInvitation";
