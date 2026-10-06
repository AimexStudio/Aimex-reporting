/**
 * Firestore layout (all dates are stored as milliseconds since 1970):
 *
 *   clients/{clientId}                                        Client (a company or group; one login)
 *   clients/{clientId}/dashboards/{dashboardId}               DashboardDoc (a sub-company or stream)
 *   clients/{clientId}/dashboards/{dashboardId}/months/{YYYY-MM}  MonthDoc (all channels for that month)
 *   clients/{clientId}/dashboards/{dashboardId}/imports/{id}     ImportDoc (upload history)
 *
 * Older data stored directly under clients/{clientId}/months is moved into a
 * dashboard with id "main" the first time the client is opened.
 *   users/{userId}                         User       (admin or client login)
 *   emails/{encoded email}                 { userId } (keeps emails unique)
 *   loginThrottle/{hash}                   failed sign-in counter
 *
 * Future API connectors (Google Ads, Meta, GA4) write channel entries into the
 * same MonthDoc with their own `source`, so dashboards need no changes.
 */

export interface Client {
  id: string;
  name: string;
  contactName: string | null;
  currency: string;
  /** Private admin-only notes. Never shown to the client. */
  adminNotes: string | null;
  /** The client's own logo, as a small image data URL, shown in their report's sidebar. */
  logo?: string | null;
  createdAt: number;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  /**
   * "admin"        = Aimex super admin: every client, every setting.
   * "client_admin" = tied to one client: views its reports and manages its data (uploads, notes, settings).
   * "client"       = tied to one client: views its reports only.
   */
  role: "admin" | "client_admin" | "client";
  /** For client and client_admin logins: the ONLY client they may see. Null for super admins. */
  clientId: string | null;
  /** Bumped on password change so existing login cookies stop working. */
  sessionVersion: number;
  lastLoginAt: number | null;
  createdAt: number;
}

/** Non-additive details kept for a row when the export has exactly one line for it. */
export interface RowAttrs { delivery?: string; resultType?: string; budget?: number; budgetType?: string; optScore?: number }
export interface BreakdownRow { label: string; metrics: Record<string, number>; attrs?: RowAttrs }
export interface AudienceRow { age: string; gender: string; metrics: Record<string, number> }
/** Which ads, ad sets, campaigns and audiences produced the results (from platform exports). */
export interface Breakdowns { ads?: BreakdownRow[]; adSets?: BreakdownRow[]; campaigns?: BreakdownRow[]; audiences?: AudienceRow[] }

export interface ChannelEntry {
  channel: string;
  metrics: Record<string, number>;
  breakdowns?: Breakdowns;
  source: string; // "csv" today; "google_ads", "meta_ads", "ga4" later
  importId: string | null;
}

/** Written analysis for one section of one month: "overview" or a channel name like "Meta Ads". */
export interface SectionNotes {
  insights: string[];
  alertTitle?: string | null;
  alertBody?: string | null;
}

export interface MonthDoc {
  month: string; // "YYYY-MM"
  channels: ChannelEntry[];
  note: string | null;
  sectionNotes?: Record<string, SectionNotes>;
  /** Actual values for manually tracked goals (e.g. reservations), by goal id. */
  goalActuals?: Record<string, number>;
  updatedAt: number;
}

export interface ImportDoc {
  id: string;
  months: string[];
  channels: string[];
  source: string;
  filename: string | null;
  rowCount: number;
  importedAt: number;
}

export interface Goal {
  id: string;
  label: string;
  /** A figure from the uploads (e.g. "leads", "cpl"), or null for a figure entered by hand each month. */
  metric: string | null;
  target: number;
  direction: "atLeast" | "atMost";
}

export interface Milestone {
  id: string;
  title: string;
  when: string;
  description: string;
  status: "done" | "current" | "upcoming";
}

export interface DashboardSettings {
  /** Market cost-per-result range for comparison, e.g. 120–200 for "Cape Town upscale property". */
  benchmark?: { min: number | null; max: number | null; label: string } | null;
  goals?: Goal[];
  milestones?: Milestone[];
  /** Starting values for the ROI planner. */
  roi?: { saleNoun: string; avgSaleValue: number | null; rate: number | null } | null;
}

export interface DashboardDoc extends DashboardSettings {
  id: string;
  name: string;
  createdAt: number;
}
