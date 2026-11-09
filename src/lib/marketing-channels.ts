/** The marketing channels a client can be shown as using (chosen by a super admin, per dashboard). */
export type ChannelGroup = "ads" | "social" | "listing" | "booking";

export const MARKETING_CHANNELS: { id: string; label: string; detail: string; group: ChannelGroup; icon: string }[] = [
  { id: "gmb", label: "Google Business Profile", detail: "GMB", group: "listing", icon: "pin" },
  { id: "meta-ads", label: "Meta Ads", detail: "Facebook and Instagram ads", group: "ads", icon: "megaphone" },
  { id: "facebook-page", label: "Facebook Page", detail: "Organic page", group: "social", icon: "people" },
  { id: "instagram-page", label: "Instagram Page", detail: "Organic profile", group: "social", icon: "camera" },
  { id: "google-ads", label: "Google Ads", detail: "Search and Performance Max", group: "ads", icon: "search" },
  { id: "roomraccoon", label: "RoomRaccoon", detail: "Booking and channel manager", group: "booking", icon: "bed" },
  { id: "nightsbridge", label: "NightsBridge", detail: "Booking and channel manager", group: "booking", icon: "moon" },
];

export const GROUP_LABEL: Record<ChannelGroup, string> = {
  ads: "Advertising",
  social: "Social pages",
  listing: "Listings",
  booking: "Booking platforms",
};

/** Only known ids, in the list's own order. */
export function cleanChannels(ids: unknown): string[] {
  const set = new Set(Array.isArray(ids) ? ids.map(String) : []);
  return MARKETING_CHANNELS.filter((c) => set.has(c.id)).map((c) => c.id);
}
