/**
 * Const map of every ROOT-side action key the audit log accepts. The
 * `SystemAuditLog.action` column is a free-form `String` so the schema stays
 * migration-stable when we add a new action, but the TS layer enforces
 * consistency via this map.
 *
 * Naming convention: `<subject>.<verb>` (lowercase, dotted, snake-case verbs).
 * Subjects align with the route layout in PLAN §3.6.3:
 *   agency.*       — actions on Agency rows
 *   subscription.* — actions on the Stripe sub state
 *   invoice.*      — actions on Invoice / Stripe invoices
 *   member.*       — actions on Member rows in a tenant
 *   admin.*        — actions on SystemAdmin rows themselves
 *   config.*       — actions on SystemConfig / AgencyLimitOverride
 *   support.*      — actions taken on a customer's behalf (resend welcome, ...)
 *   abuse.*        — actions on AbuseReport rows
 *   impersonate.*  — impersonation envelope lifecycle (start, end, write-promote)
 */
export const SYSTEM_AUDIT_ACTIONS = {
  AGENCY_SUSPEND: "agency.suspend",
  AGENCY_UNSUSPEND: "agency.unsuspend",
  AGENCY_GRANT_PLAN_OVERRIDE: "agency.grant_plan_override",
  AGENCY_REVOKE_PLAN_OVERRIDE: "agency.revoke_plan_override",
  AGENCY_HARD_DELETE: "agency.hard_delete",
  AGENCY_UPDATE_NOTE: "agency.update_note",

  SUBSCRIPTION_FORCE_CANCEL: "subscription.force_cancel",
  SUBSCRIPTION_EXTEND_TRIAL: "subscription.extend_trial",

  INVOICE_REFUND_REQUEST: "invoice.refund_request",

  MEMBER_FORCE_REMOVE: "member.force_remove",

  ADMIN_CREATE: "admin.create",
  ADMIN_ROLE_CHANGE: "admin.role_change",
  ADMIN_DEACTIVATE: "admin.deactivate",
  ADMIN_REACTIVATE: "admin.reactivate",

  CONFIG_UPDATE: "config.update",
  CONFIG_AGENCY_LIMIT_OVERRIDE: "config.agency_limit_override",

  SUPPORT_RESEND_WELCOME: "support.resend_welcome",
  SUPPORT_RESET_PASSWORD: "support.reset_password",
  SUPPORT_REGENERATE_PORTAL_LINK: "support.regenerate_portal_link",
  SUPPORT_REFIRE_INNGEST_RUN: "support.refire_inngest_run",

  ABUSE_ASSIGN: "abuse.assign",
  ABUSE_RESOLVE: "abuse.resolve",
  ABUSE_DISMISS: "abuse.dismiss",

  IMPERSONATE_START: "impersonate.start",
  IMPERSONATE_END: "impersonate.end",
  IMPERSONATE_PROMOTE_WRITE: "impersonate.promote_write",
  TENANT_PROXY_WRITE: "tenant.proxy_write",
} as const;

export type SystemAuditAction = (typeof SYSTEM_AUDIT_ACTIONS)[keyof typeof SYSTEM_AUDIT_ACTIONS];
