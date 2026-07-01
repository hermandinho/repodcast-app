import Link from "next/link";
import { PricingPicker } from "@/components/pricing/pricing-picker";

/**
 * Public pricing page — the top of the self-service funnel. Renders the
 * three plan tiles with a monthly/annual toggle + currency picker, plus a
 * "Get Started" CTA per tile that carries the (plan, cadence, currency)
 * selection through Clerk sign-up and into the onboarding router.
 *
 * Middleware allows unauthenticated access; the picker itself is a client
 * component so the toggle + currency picker can be interactive without a
 * round-trip. Sign-up itself is Clerk-hosted.
 */
export const dynamic = "force-static";

export default function PricingPage() {
  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        background: "radial-gradient(120% 80% at 100% 0%, #EEF2FB 0%, #F4F6FA 45%, #F4F6FA 100%)",
        color: "#1A2A4A",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(58,91,160,0.16) 0%, rgba(58,91,160,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-32 h-[460px] w-[460px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(46,158,91,0.12) 0%, rgba(46,158,91,0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-[1080px] flex-col gap-10 px-6 py-12 sm:py-16">
        <header className="flex items-center justify-between">
          <Link href="/" className="font-display text-[16px] font-semibold tracking-tight">
            Repodcast
          </Link>
          <nav className="flex items-center gap-4 text-[13.5px]">
            <Link href="/sign-in" className="hover:underline">
              Sign in
            </Link>
          </nav>
        </header>

        <div className="flex flex-col items-center text-center">
          <h1 className="font-display text-[36px] font-semibold tracking-tight sm:text-[44px]">
            Simple, honest pricing.
          </h1>
          <p className="mt-3 max-w-[560px] text-[15px] text-[#5B6A85]">
            Pick a tier that fits your studio. Annual saves you two months. Switch or cancel any
            time from Settings.
          </p>
        </div>

        <PricingPicker />

        <div className="mt-4 text-center text-[12.5px] text-[#8B95A6]">
          Prices shown are exclusive of local sales tax. Enterprise volume? Contact us.
        </div>
      </div>
    </div>
  );
}
