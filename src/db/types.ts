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
  createdAt: number;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: "admin" | "client";
  /** For client logins: the ONLY client they may see. Null for admins. */
  clientId: string | null;
  /** Bumped on password change so existing login cookies stop working. */
  sessionVersion: number;
  lastLoginAt: number | null;
  createdAt: number;
}

export interface BreakdownRow { label: string; metrics: Record<string, number> }
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

export interface MonthDoc {
  month: string; // "YYYY-MM"
  channels: ChannelEntry[];
  note: string | null;
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

export interface DashboardDoc {
  id: string;
  name: string;
  createdAt: number;
}
