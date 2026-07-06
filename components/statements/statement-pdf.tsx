import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Platform } from "@prisma/client";

/**
 * Phase 3.8 — client-statement PDF renderer.
 *
 * Rendered via `@react-pdf/renderer`'s `renderToBuffer` inside a Node route
 * handler; no DOM primitives, only `<Document>`, `<Page>`, `<View>`,
 * `<Text>`. Layout intentionally simple: a header block, a metric grid, a
 * per-platform table, and a footer. Uses the built-in Helvetica family so
 * we don't have to ship or fetch a font blob at request time.
 *
 * Numbers come pre-formatted from the caller so the renderer stays
 * concerned only with layout — cost is USD cents in / USD dollars out at
 * the API layer, not here.
 */

export type StatementPdfData = {
  agencyName: string;
  brandAccentColor: string | null;
  clientName: string;
  periodStartIso: string;
  periodEndIso: string;
  generatedAtIso: string;
  generatedByLabel: string;
  /** Statement currency, pre-formatted here as the total string; the
   *  ISO code is passed in so the items table can format each row. */
  currency: string;
  totals: {
    episodeCount: number;
    outputCount: number;
    approvedCount: number;
    approvalRatePct: number;
    /** Pre-formatted total (sum of item amounts) in the statement's currency. */
    totalFormatted: string;
  };
  /** Billable line items — what the client owes the agency for the period. */
  items: Array<{
    description: string;
    /** Formatted quantity (e.g. "12", "0.5"). */
    quantityLabel: string;
    /** Pre-formatted unit price + amount, in the statement's currency. */
    unitLabel: string;
    amountLabel: string;
  }>;
  breakdown: Array<{ platform: Platform; total: number; approved: number }>;
};

const DEFAULT_ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";
const MUTED_2 = "#8B95A6";
const BORDER = "#E4E8F0";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    lineHeight: 1.4,
  },
  eyebrow: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    letterSpacing: 1.6,
    color: MUTED_2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  h1: {
    fontFamily: "Helvetica-Bold",
    fontSize: 22,
    letterSpacing: -0.4,
    color: INK,
    marginBottom: 2,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  brandBlock: { textAlign: "right" },
  brandName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: INK,
  },
  brandTag: {
    fontSize: 9,
    color: MUTED_2,
    marginTop: 3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  meta: { fontSize: 10, color: MUTED, marginTop: 4 },
  metaLabel: { color: MUTED_2 },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginTop: 6,
    marginBottom: 22,
  },
  sectionLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 1,
    color: MUTED_2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 28,
  },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    padding: 12,
  },
  metricLabel: {
    fontSize: 8,
    color: MUTED_2,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  metricValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 20,
    color: INK,
    letterSpacing: -0.3,
  },
  totalCard: {
    flex: 1.4,
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
  },
  totalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 20,
    letterSpacing: -0.3,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F4F6FA",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  tableHeaderCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: MUTED,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tableCell: { fontSize: 10, color: INK },
  tablePlatformCol: { flex: 2 },
  tableNumCol: { flex: 1, textAlign: "right" },
  itemsHeader: {
    flexDirection: "row",
    backgroundColor: "#F4F6FA",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  itemDescriptionCol: { flex: 3 },
  itemQtyCol: { flex: 0.7, textAlign: "right" },
  itemUnitCol: { flex: 1, textAlign: "right" },
  itemAmountCol: { flex: 1.1, textAlign: "right" },
  itemsTotalRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 4,
  },
  itemsTotalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    flex: 4.7,
    textAlign: "right",
    paddingRight: 10,
  },
  itemsTotalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: INK,
    flex: 1.1,
    textAlign: "right",
  },
  emptyItems: {
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
    borderRadius: 6,
    paddingVertical: 20,
    textAlign: "center",
    fontSize: 10,
    color: MUTED_2,
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8,
    color: MUTED_2,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});

const PLATFORM_LABEL: Record<Platform, string> = {
  TWITTER: "X (Twitter)",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  SHOW_NOTES: "Show notes",
  BLOG: "Blog",
  NEWSLETTER: "Newsletter",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function StatementPdf({ data }: { data: StatementPdfData }) {
  const accent = data.brandAccentColor?.match(/^#[0-9a-fA-F]{6}$/)
    ? data.brandAccentColor
    : DEFAULT_ACCENT;

  return (
    <Document
      title={`Statement — ${data.clientName} — ${formatDate(data.periodStartIso)} to ${formatDate(data.periodEndIso)}`}
      author={data.agencyName}
      producer="Repodcast"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>Client statement</Text>
            <Text style={styles.h1}>{data.clientName}</Text>
            <Text style={styles.meta}>
              <Text style={styles.metaLabel}>Period · </Text>
              {formatDate(data.periodStartIso)} → {formatDate(data.periodEndIso)}
            </Text>
            <Text style={styles.meta}>
              <Text style={styles.metaLabel}>Generated · </Text>
              {formatDate(data.generatedAtIso)} by {data.generatedByLabel}
            </Text>
          </View>
          <View style={styles.brandBlock}>
            <Text style={styles.brandName}>{data.agencyName}</Text>
            <Text style={[styles.brandTag, { color: accent }]}>Prepared for you</Text>
          </View>
        </View>

        <View style={styles.hr} />

        <Text style={styles.sectionLabel}>Delivery snapshot</Text>
        <View style={styles.metricsRow}>
          <MetricCard label="Episodes" value={data.totals.episodeCount.toLocaleString()} />
          <MetricCard label="Outputs" value={data.totals.outputCount.toLocaleString()} />
          <MetricCard
            label="Approved"
            value={`${data.totals.approvedCount.toLocaleString()} · ${data.totals.approvalRatePct}%`}
          />
          <View style={[styles.totalCard, { borderColor: accent, backgroundColor: `${accent}12` }]}>
            <Text style={styles.metricLabel}>Amount due</Text>
            <Text style={[styles.totalValue, { color: accent }]}>{data.totals.totalFormatted}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Billable items</Text>
        {data.items.length === 0 ? (
          <Text style={styles.emptyItems}>No line items on this statement.</Text>
        ) : (
          <>
            <View style={styles.itemsHeader}>
              <Text style={[styles.tableHeaderCell, styles.itemDescriptionCol]}>Description</Text>
              <Text style={[styles.tableHeaderCell, styles.itemQtyCol]}>Qty</Text>
              <Text style={[styles.tableHeaderCell, styles.itemUnitCol]}>Unit</Text>
              <Text style={[styles.tableHeaderCell, styles.itemAmountCol]}>Amount</Text>
            </View>
            {data.items.map((row, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.itemDescriptionCol]}>{row.description}</Text>
                <Text style={[styles.tableCell, styles.itemQtyCol]}>{row.quantityLabel}</Text>
                <Text style={[styles.tableCell, styles.itemUnitCol]}>{row.unitLabel}</Text>
                <Text style={[styles.tableCell, styles.itemAmountCol]}>{row.amountLabel}</Text>
              </View>
            ))}
            <View style={styles.itemsTotalRow}>
              <Text style={styles.itemsTotalLabel}>Total</Text>
              <Text style={styles.itemsTotalValue}>{data.totals.totalFormatted}</Text>
            </View>
          </>
        )}

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Per-platform breakdown</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, styles.tablePlatformCol]}>Platform</Text>
          <Text style={[styles.tableHeaderCell, styles.tableNumCol]}>Total outputs</Text>
          <Text style={[styles.tableHeaderCell, styles.tableNumCol]}>Approved</Text>
        </View>
        {data.breakdown.map((row) => (
          <View key={row.platform} style={styles.tableRow}>
            <Text style={[styles.tableCell, styles.tablePlatformCol]}>
              {PLATFORM_LABEL[row.platform] ?? row.platform}
            </Text>
            <Text style={[styles.tableCell, styles.tableNumCol]}>{row.total.toLocaleString()}</Text>
            <Text style={[styles.tableCell, styles.tableNumCol]}>
              {row.approved.toLocaleString()}
            </Text>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{data.agencyName}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}
