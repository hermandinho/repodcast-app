/**
 * Sample data for parent customer Clients (Phase: hierarchy refactor).
 * Each Client owns one or more Shows — see `lib/sample-data/shows.ts`.
 */

export type SampleClient = {
  key: string;
  name: string;
  description: string;
  contactName: string;
  contactEmail: string;
  /** Empty string when unset — UI falls back to the initials avatar. */
  artworkUrl: string;
  initial: string;
  avatarBg: string;
};

export const sampleClients: SampleClient[] = [
  {
    key: "northwind",
    name: "Northwind Media",
    description:
      "Independent podcast network running shows on startups, the outdoors, and personal finance.",
    contactName: "Avery Lin",
    contactEmail: "avery@northwind.media",
    artworkUrl: "",
    initial: "NM",
    avatarBg: "#3A5BA0",
  },
  {
    key: "moneymatters",
    name: "Money Matters Co",
    description: "Personal-finance media company. One flagship show, weekly newsletter.",
    contactName: "Priya Anand",
    contactEmail: "priya@moneymatters.co",
    artworkUrl: "",
    initial: "MM",
    avatarBg: "#7A4FB0",
  },
];

export function getClient(key: string): SampleClient | undefined {
  return sampleClients.find((c) => c.key === key);
}
