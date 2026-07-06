import { describe, expect, it } from "vitest";
import { Plan } from "@prisma/client";
import {
  CURRENCY_META,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  asSupportedCurrency,
  formatPlanPrice,
} from "@/lib/currencies";
import { PLAN_PRICES_BY_CURRENCY, priceFor } from "@/lib/plans";

describe("lib/currencies", () => {
  it("includes USD and uppercases the codes", () => {
    expect(SUPPORTED_CURRENCIES).toContain("USD");
    expect(DEFAULT_CURRENCY).toBe("USD");
    for (const c of SUPPORTED_CURRENCIES) {
      expect(c).toBe(c.toUpperCase());
    }
  });

  it("has metadata for every supported currency", () => {
    for (const c of SUPPORTED_CURRENCIES) {
      const meta = CURRENCY_META[c];
      expect(meta.code).toBe(c);
      expect(meta.stripeCode).toBe(c.toLowerCase());
      expect(meta.symbol.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  describe("asSupportedCurrency", () => {
    it("accepts canonical codes case-insensitively", () => {
      expect(asSupportedCurrency("USD")).toBe("USD");
      expect(asSupportedCurrency("eur")).toBe("EUR");
      expect(asSupportedCurrency("  gbp  ")).toBe("GBP");
    });

    it("rejects unknown codes and empty input", () => {
      expect(asSupportedCurrency("CHF")).toBeNull();
      expect(asSupportedCurrency("")).toBeNull();
      expect(asSupportedCurrency(null)).toBeNull();
      expect(asSupportedCurrency(undefined)).toBeNull();
    });
  });

  describe("formatPlanPrice", () => {
    it("renders whole-currency amounts with the right symbol", () => {
      // Intl.NumberFormat output uses non-breaking spaces in some locales —
      // assert the visible characters via a normalised match.
      const usd = formatPlanPrice(99, "USD").replace(/ /g, " ");
      expect(usd).toBe("$99");

      const eur = formatPlanPrice(99, "EUR").replace(/ /g, " ");
      // en-US locale renders EUR as "€99".
      expect(eur).toMatch(/^€?99?€?/);
      expect(eur).toContain("99");
    });
  });
});

describe("lib/plans · priceFor", () => {
  it("returns the configured monthly price for each (plan, currency) pair", () => {
    for (const plan of [Plan.SOLO, Plan.STUDIO, Plan.AGENCY, Plan.NETWORK]) {
      for (const c of SUPPORTED_CURRENCIES) {
        expect(priceFor(plan, c)).toBe(PLAN_PRICES_BY_CURRENCY[plan].monthly[c]);
      }
    }
  });

  it("defaults to USD monthly when no currency or cadence is passed", () => {
    expect(priceFor(Plan.SOLO)).toBe(PLAN_PRICES_BY_CURRENCY.SOLO.monthly.USD);
    expect(priceFor(Plan.STUDIO)).toBe(PLAN_PRICES_BY_CURRENCY.STUDIO.monthly.USD);
    expect(priceFor(Plan.AGENCY)).toBe(PLAN_PRICES_BY_CURRENCY.AGENCY.monthly.USD);
    expect(priceFor(Plan.NETWORK)).toBe(PLAN_PRICES_BY_CURRENCY.NETWORK.monthly.USD);
  });

  it("returns annual prices when cadence = ANNUAL", () => {
    for (const plan of [Plan.SOLO, Plan.STUDIO, Plan.AGENCY, Plan.NETWORK]) {
      for (const c of SUPPORTED_CURRENCIES) {
        expect(priceFor(plan, c, "ANNUAL")).toBe(PLAN_PRICES_BY_CURRENCY[plan].annual[c]);
      }
    }
  });

  it("annual price equals monthly × 10 (two months free) for every (plan, currency)", () => {
    for (const plan of [Plan.SOLO, Plan.STUDIO, Plan.AGENCY, Plan.NETWORK]) {
      for (const c of SUPPORTED_CURRENCIES) {
        expect(priceFor(plan, c, "ANNUAL")).toBe(priceFor(plan, c, "MONTHLY") * 10);
      }
    }
  });
});
