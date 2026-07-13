"""
Draws the Repodcast architecture diagram covering:
  - Currently shipped services (from AboutUs.md)
  - New features + tools from NextMove.md (zero-budget path)

Output: docs/architecture.png (24x18 in @ 150 DPI = 3600x2700 px).

Usage: python scripts/draw-architecture.py
"""

from __future__ import annotations

import os
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Patch


# --------------------------------------------------------------------------
# Colour palette
# --------------------------------------------------------------------------

CLR_EXISTING = "#2563EB"      # blue     — services already shipped
CLR_NEW      = "#EA580C"      # orange   — new services from NextMove.md
CLR_USER     = "#4B5563"      # gray     — user personas
CLR_EXTERNAL = "#059669"      # green    — third-party platforms we publish to
CLR_GROUP_BG = "#F3F4F6"      # very light gray — cluster background
CLR_GROUP_BR = "#D1D5DB"      # cluster border
CLR_TEXT_LT  = "#FFFFFF"      # white text on coloured boxes
CLR_ARROW    = "#6B7280"      # gray arrows
CLR_ARROW_HL = "#111827"      # emphasis arrows


# --------------------------------------------------------------------------
# Node registry — (id, x, y, w, h, label, sublabel, colour)
# Coordinates are in inches, origin bottom-left. Canvas is 26" x 18".
# --------------------------------------------------------------------------

# We track every node in a dict so we can draw arrows by id later.
NODES: dict[str, dict] = {}


def add(
    node_id: str,
    x: float, y: float, w: float, h: float,
    label: str,
    sub: str = "",
    color: str = CLR_EXISTING,
) -> None:
    NODES[node_id] = {
        "x": x, "y": y, "w": w, "h": h,
        "cx": x + w / 2, "cy": y + h / 2,
        "label": label, "sub": sub, "color": color,
    }


# --------------------------------------------------------------------------
# Layout
# --------------------------------------------------------------------------
# Canvas is 26 wide x 18 tall. Y grows upward.
# Rough vertical bands:
#   y=16.5 : Users
#   y=15.0 : Edge
#   y=12.5-14.3 : Application (Next.js) — tall container
#   y=10.5 : Orchestration (Inngest + Media Worker)
#   y=8.5  : AI services
#   y=6.5  : Data stores
#   y=4.5  : Publishing (wide row)
#   y=2.5  : Notifications + Imports
#   y=0.5  : Legend

# --- Users ---------------------------------------------------------------
add("user_agency", 2.0,  16.5, 3.5, 0.9, "Agency Members",
    "OWNER · ADMIN · EDITOR · REVIEWER", CLR_USER)
add("user_client", 6.5,  16.5, 3.5, 0.9, "Clients",
    "token-gated portal", CLR_USER)
add("user_api",   11.0, 16.5, 3.5, 0.9, "API Consumers",
    "Zapier · custom · SDK (new)", CLR_USER)
add("user_root",  15.5, 16.5, 3.5, 0.9, "ROOT Admins",
    "internal ops", CLR_USER)

# --- Edge ---------------------------------------------------------------
add("edge_caddy",   3.0, 15.0, 4.0, 0.9, "Caddy — on-demand TLS  [NEW]",
    "white-label portal domains (#3)", CLR_NEW)
add("edge_vercel",  10.5, 15.0, 5.0, 0.9, "Vercel",
    "Next.js host · edge middleware", CLR_EXISTING)

# --- Application (large centre container) -------------------------------
# We draw the container as a background rect and then place the sub-boxes.
APP_X, APP_Y, APP_W, APP_H = 0.8, 12.4, 18.5, 2.3

# App Router pages
add("app_dashboard", 1.3, 13.6, 3.4, 0.9, "Dashboard",
    "KPIs · episodes · voice · schedule · clients · settings", CLR_EXISTING)
add("app_portal",    5.0, 13.6, 3.0, 0.9, "Client Portal",
    "approvals · deliverables · statements", CLR_EXISTING)
add("app_marketing", 8.3, 13.6, 2.6, 0.9, "Marketing",
    "landing · pricing · legal · blog", CLR_EXISTING)
add("app_onboard",  11.2, 13.6, 2.4, 0.9, "Onboarding",
    "workspace → plan → trial", CLR_EXISTING)
add("app_admin",    14.0, 13.6, 2.5, 0.9, "ROOT admin",
    "audit log · config · finance", CLR_EXISTING)

# API surface
add("api_webhooks", 1.3, 12.5, 3.4, 0.9, "/api/webhooks/*",
    "Clerk · Stripe (idempotent)", CLR_EXISTING)
add("api_integ",    5.0, 12.5, 3.0, 0.9, "/api/integrations/*",
    "Buffer OAuth · Slack/Teams (new)", CLR_EXISTING)
add("api_stream",   8.3, 12.5, 2.6, 0.9, "/api/episodes/*/stream",
    "SSE progress + comments (new)", CLR_EXISTING)
add("api_inngest", 11.2, 12.5, 2.4, 0.9, "/api/inngest",
    "job handler endpoint", CLR_EXISTING)
add("api_v1",      14.0, 12.5, 2.5, 0.9, "/api/v1/*  [NEW]",
    "public REST API (#6)", CLR_NEW)
add("api_root",    16.8, 13.05, 2.3, 0.9, "/api/root/*",
    "finance CSV export", CLR_EXISTING)

# --- Auth + Billing (left side spine) -----------------------------------
add("clerk",   20.5, 15.0, 4.0, 0.9, "Clerk",
    "identity · SSO on paid tier", CLR_EXISTING)
add("stripe",  20.5, 13.9, 4.0, 0.9, "Stripe",
    "checkout · subscriptions · webhooks", CLR_EXISTING)

# --- Orchestration ------------------------------------------------------
add("inngest",  1.5, 10.5, 8.0, 1.3, "Inngest",
    "generateEpisode · regenerateOutput · transcribeEpisode · "
    "importRss/Youtube · refreshVoiceDescription · syncScheduledOutputs · "
    "checkRenewals · nightlyUsageRollup · pullOutputMetrics [NEW] · "
    "renderClip [NEW] · renderAudiogram [NEW] · generateArtwork [NEW]",
    CLR_EXISTING)

add("media_worker", 10.5, 10.5, 8.0, 1.3, "Media Worker  [NEW]",
    "Hetzner CPX11 / Oracle Cloud ARM (~$4-8/mo)\n"
    "ffmpeg (clips #1 · audiograms #5 · trailers #22)\n"
    "Caddy on-demand TLS (#3)  ·  Self-hosted Svix (#6)",
    CLR_NEW)

# --- AI services --------------------------------------------------------
add("claude",    1.5, 8.5, 4.6, 1.0, "Anthropic Claude",
    "claude-sonnet-4-6 · generation · voice desc · PDF ingest (#12 new)",
    CLR_EXISTING)
add("deepgram",  6.4, 8.5, 4.2, 1.0, "Deepgram",
    "transcription · diarize=true (#19 new) · timestamps for captions",
    CLR_EXISTING)
add("cf_ai", 10.8, 8.5, 5.8, 1.0, "Cloudflare Workers AI  [NEW]",
    "flux-1-schnell (artwork #4) · BGE embeddings (voice drift #18)",
    CLR_NEW)

# --- Data stores --------------------------------------------------------
add("neon",      1.5, 6.5, 6.0, 1.0, "Neon Postgres (Prisma 7)",
    "tenant model · outputs · voice samples · pgvector [NEW: #18]",
    CLR_EXISTING)
add("r2",        7.8, 6.5, 4.5, 1.0, "Cloudflare R2",
    "audio · statements · logos · clips/audiograms/artwork (new)\n"
    "egress = $0 (skip Cloudflare Stream)",
    CLR_EXISTING)
add("upstash",  12.5, 6.5, 4.1, 1.0, "Upstash Redis  [NEW]",
    "API rate limiting (#6) · free tier: 10k cmd/day",
    CLR_NEW)

# --- Right-column outbound + observability ------------------------------
add("scalar",   20.5, 12.5, 4.0, 1.0, "Scalar / Nextra  [NEW]",
    "public API docs (#6) · self-hosted from OpenAPI yaml",
    CLR_NEW)
add("posthog",  20.5, 10.7, 4.0, 0.9, "PostHog",
    "feature flags · analytics",
    CLR_EXISTING)
add("sentry",   20.5,  9.6, 4.0, 0.9, "Sentry",
    "error tracking (lazy init)",
    CLR_EXISTING)

# --- Imports ------------------------------------------------------------
add("podcastindex", 1.5, 2.5, 4.5, 1.0, "Podcast Index",
    "RSS lookup · SHA-1 HMAC auth",
    CLR_EXISTING)
add("youtube_capt", 6.2, 2.5, 4.5, 1.0, "YouTube Data API",
    "captions (existing) · Shorts upload + chapters (#10, #11 new)",
    CLR_EXISTING)

# --- Notifications ------------------------------------------------------
add("resend",  10.9, 2.5, 3.2, 1.0, "Resend",
    "workflow emails · nudges · portal notifications",
    CLR_EXISTING)
add("slack",   14.3, 2.5, 3.0, 1.0, "Slack  [NEW]",
    "Incoming Webhook (#7) · free",
    CLR_NEW)
add("teams",   17.5, 2.5, 3.0, 1.0, "Teams  [NEW]",
    "Incoming Webhook (#7) · free",
    CLR_NEW)
add("apple",   20.7, 2.5, 3.8, 1.0, "Apple Push (via web-push)",
    "PWA notifications (#16 new)",
    CLR_NEW)

# --- Publishing (wide row) ----------------------------------------------
PUB_Y = 4.5
# existing
add("buffer",  1.5, PUB_Y, 3.3, 1.0, "Buffer",
    "X · LinkedIn · Instagram · TikTok\n(existing OAuth + GraphQL)",
    CLR_EXISTING)
# new native social
add("bluesky",   5.0, PUB_Y, 2.1, 1.0, "Bluesky  [NEW]",
    "@atproto/api", CLR_NEW)
add("mastodon",  7.2, PUB_Y, 2.1, 1.0, "Mastodon  [NEW]",
    "per-instance OAuth", CLR_NEW)
add("threads",   9.4, PUB_Y, 2.1, 1.0, "Threads  [NEW]",
    "Meta Graph API", CLR_NEW)
add("reddit",   11.6, PUB_Y, 2.1, 1.0, "Reddit  [NEW]",
    "OAuth2 · /api/submit", CLR_NEW)
add("shorts",   13.8, PUB_Y, 2.1, 1.0, "YT Shorts  [NEW]",
    "videos.insert", CLR_NEW)
# blog CMSs
add("wp",       16.0, PUB_Y, 1.6, 1.0, "WordPress [NEW]",
    "REST v2", CLR_NEW)
add("ghost",    17.7, PUB_Y, 1.6, 1.0, "Ghost  [NEW]",
    "@tryghost/admin-api", CLR_NEW)
add("webflow",  19.4, PUB_Y, 1.6, 1.0, "Webflow [NEW]",
    "CMS API v2", CLR_NEW)
# newsletter
add("beehiiv",  21.1, PUB_Y, 1.6, 1.0, "Beehiiv [NEW]",
    "v2 API", CLR_NEW)
add("convertkit",22.8, PUB_Y, 1.7, 1.0, "ConvertKit[NEW]",
    "v3 API", CLR_NEW)


# --------------------------------------------------------------------------
# Drawing helpers
# --------------------------------------------------------------------------

def draw_group(ax, x, y, w, h, title):
    """Draw a light-fill background rectangle labelling a cluster."""
    r = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.05,rounding_size=0.18",
        linewidth=1.0, edgecolor=CLR_GROUP_BR,
        facecolor=CLR_GROUP_BG, zorder=0,
    )
    ax.add_patch(r)
    ax.text(x + 0.15, y + h - 0.2, title,
            fontsize=9, color="#374151",
            fontweight="bold", ha="left", va="top", zorder=1)


def draw_node(ax, node_id):
    n = NODES[node_id]
    box = FancyBboxPatch(
        (n["x"], n["y"]), n["w"], n["h"],
        boxstyle="round,pad=0.02,rounding_size=0.09",
        linewidth=0, facecolor=n["color"], zorder=2,
    )
    ax.add_patch(box)
    # Label
    ax.text(
        n["cx"], n["y"] + n["h"] - 0.22,
        n["label"],
        fontsize=10.5, color=CLR_TEXT_LT,
        fontweight="bold", ha="center", va="top", zorder=3,
    )
    # Sublabel
    if n["sub"]:
        ax.text(
            n["cx"], n["y"] + n["h"] - 0.45,
            n["sub"],
            fontsize=7.6, color=CLR_TEXT_LT,
            ha="center", va="top", zorder=3,
            linespacing=1.2,
        )


def arrow(ax, src_id, dst_id, *, side_src="bottom", side_dst="top",
          color=CLR_ARROW, lw=1.0, style="-|>", offset=(0, 0)):
    """Draw an arrow between two nodes using named side anchors."""
    a = NODES[src_id]
    b = NODES[dst_id]

    def anchor(node, side):
        if side == "top":    return (node["cx"], node["y"] + node["h"])
        if side == "bottom": return (node["cx"], node["y"])
        if side == "left":   return (node["x"], node["cy"])
        if side == "right":  return (node["x"] + node["w"], node["cy"])
        if side == "cx_top": return (node["cx"] - 0.4, node["y"] + node["h"])
        if side == "cx_bot": return (node["cx"] + 0.4, node["y"])
        raise ValueError(side)

    sx, sy = anchor(a, side_src)
    dx, dy = anchor(b, side_dst)
    sx += offset[0]; sy += offset[1]

    arr = FancyArrowPatch(
        (sx, sy), (dx, dy),
        arrowstyle=style, mutation_scale=12,
        linewidth=lw, color=color,
        connectionstyle="arc3,rad=0.05",
        zorder=4,
    )
    ax.add_patch(arr)


# --------------------------------------------------------------------------
# Compose the figure
# --------------------------------------------------------------------------

fig, ax = plt.subplots(figsize=(26, 18), dpi=150)
ax.set_xlim(0, 26)
ax.set_ylim(0, 18)
ax.set_aspect("equal")
ax.axis("off")

# --- Title band --------------------------------------------------------
ax.text(13, 17.65,
        "Repodcast — System Architecture",
        fontsize=22, fontweight="bold",
        color="#111827", ha="center", va="center")
ax.text(13, 17.25,
        "Currently shipped services + zero-budget stack from NextMove.md",
        fontsize=12, color="#6B7280",
        ha="center", va="center")

# --- Cluster backgrounds ----------------------------------------------
draw_group(ax, 0.6, 16.35, 18.9, 1.15, "Users")
draw_group(ax, 0.6, 14.85, 18.9, 1.10, "Edge")
draw_group(ax, APP_X - 0.2, APP_Y - 0.2, APP_W + 0.4, APP_H + 0.4,
           "Application  ·  Next.js 16 App Router  ·  React 19.2")
draw_group(ax, 19.9, 13.75, 4.6, 2.20, "Auth & Billing")
draw_group(ax, 19.9, 9.35, 4.6, 4.30, "Observability + API docs")
draw_group(ax, 0.6, 10.15, 19.0, 1.85, "Job orchestration & compute")
draw_group(ax, 0.6, 8.20, 16.0, 1.50, "AI services")
draw_group(ax, 0.6, 6.20, 16.2, 1.50, "Data stores")
draw_group(ax, 0.6, 4.20, 24.7, 1.55, "Publishing surface (new adapters + existing Buffer)")
draw_group(ax, 0.6, 2.20, 24.5, 1.55, "Imports · Notifications · Push")

# --- Draw all nodes ---------------------------------------------------
for node_id in NODES:
    draw_node(ax, node_id)

# --- Primary arrows ---------------------------------------------------
# Users -> Edge
arrow(ax, "user_agency",  "edge_vercel", side_src="bottom", side_dst="top")
arrow(ax, "user_root",    "edge_vercel", side_src="bottom", side_dst="top")
arrow(ax, "user_client",  "edge_caddy",  side_src="bottom", side_dst="top",
      color=CLR_ARROW_HL, lw=1.4)
arrow(ax, "user_client",  "edge_vercel", side_src="bottom", side_dst="top")
arrow(ax, "user_api",     "edge_vercel", side_src="bottom", side_dst="top")

# Edge -> App
arrow(ax, "edge_caddy",   "app_portal",    side_src="bottom", side_dst="top",
      color=CLR_ARROW_HL, lw=1.4)
arrow(ax, "edge_vercel",  "app_dashboard", side_src="bottom", side_dst="top")
arrow(ax, "edge_vercel",  "app_marketing", side_src="bottom", side_dst="top")

# Auth/billing -> App webhooks
arrow(ax, "clerk",   "api_webhooks", side_src="left", side_dst="right",
      color=CLR_ARROW)
arrow(ax, "stripe",  "api_webhooks", side_src="left", side_dst="right",
      color=CLR_ARROW)

# App -> Inngest / Media Worker
arrow(ax, "api_inngest",  "inngest",      side_src="bottom", side_dst="top")
arrow(ax, "app_dashboard","inngest",      side_src="bottom", side_dst="top")

# Inngest -> Media Worker (delegates ffmpeg jobs)
arrow(ax, "inngest",      "media_worker", side_src="right", side_dst="left",
      color=CLR_ARROW_HL, lw=1.4)

# Inngest -> AI services
arrow(ax, "inngest",      "claude",       side_src="bottom", side_dst="top")
arrow(ax, "inngest",      "deepgram",     side_src="bottom", side_dst="top")
arrow(ax, "media_worker", "cf_ai",        side_src="bottom", side_dst="top",
      color=CLR_ARROW_HL, lw=1.4)
arrow(ax, "inngest",      "cf_ai",        side_src="bottom", side_dst="top")

# AI + Media Worker -> Data
arrow(ax, "claude",       "neon",         side_src="bottom", side_dst="top")
arrow(ax, "deepgram",     "neon",         side_src="bottom", side_dst="top")
arrow(ax, "cf_ai",        "r2",           side_src="bottom", side_dst="top")
arrow(ax, "cf_ai",        "neon",         side_src="bottom", side_dst="top")
arrow(ax, "media_worker", "r2",           side_src="bottom", side_dst="top",
      color=CLR_ARROW_HL, lw=1.4)

# API v1 -> Upstash for rate limit
arrow(ax, "api_v1",       "upstash",      side_src="bottom", side_dst="top",
      color=CLR_ARROW_HL, lw=1.4)
# API v1 -> Neon
arrow(ax, "api_v1",       "neon",         side_src="bottom", side_dst="top")
# Media worker -> Svix (co-located)
# Svix (running on media worker) fires outbound webhooks — no separate box.

# Inngest -> Publishing
for pub in ("buffer", "bluesky", "mastodon", "threads",
            "reddit", "shorts", "wp", "ghost", "webflow",
            "beehiiv", "convertkit"):
    color = CLR_ARROW_HL if pub == "buffer" else CLR_ARROW
    arrow(ax, "inngest", pub, side_src="bottom", side_dst="top",
          color=color, lw=1.0)

# Inngest -> Notifications
arrow(ax, "inngest", "resend",  side_src="bottom", side_dst="top")
arrow(ax, "inngest", "slack",   side_src="bottom", side_dst="top",
      color=CLR_ARROW)
arrow(ax, "inngest", "teams",   side_src="bottom", side_dst="top",
      color=CLR_ARROW)

# App -> Imports
arrow(ax, "inngest", "podcastindex", side_src="bottom", side_dst="top")
arrow(ax, "inngest", "youtube_capt", side_src="bottom", side_dst="top")

# App -> Observability
arrow(ax, "app_dashboard", "posthog", side_src="right", side_dst="left",
      color=CLR_ARROW)
arrow(ax, "app_dashboard", "sentry",  side_src="right", side_dst="left",
      color=CLR_ARROW)

# Scalar -> external API consumers (docs)
arrow(ax, "scalar", "user_api", side_src="top", side_dst="bottom",
      color=CLR_ARROW)

# API v1 -> Scalar (docs generated from OpenAPI)
arrow(ax, "api_v1", "scalar", side_src="right", side_dst="left",
      color=CLR_ARROW)

# PWA push (Apple) -> Client via portal
arrow(ax, "apple", "user_client", side_src="top", side_dst="bottom",
      color=CLR_ARROW)


# --------------------------------------------------------------------------
# Legend
# --------------------------------------------------------------------------
legend_items = [
    Patch(facecolor=CLR_EXISTING, edgecolor="none",
          label="Existing service (shipped)"),
    Patch(facecolor=CLR_NEW,      edgecolor="none",
          label="New — NextMove.md (zero-budget)"),
    Patch(facecolor=CLR_USER,     edgecolor="none",
          label="User persona"),
]
leg = ax.legend(
    handles=legend_items,
    loc="lower center",
    bbox_to_anchor=(0.5, 0.005),
    ncol=3,
    fontsize=11,
    frameon=True,
    facecolor="#FFFFFF",
    edgecolor="#D1D5DB",
)

# Footer with key flow annotations
ax.text(
    0.6, 0.35,
    "Emphasised arrows (dark, thicker) mark critical paths: client → portal via Caddy · Inngest → Media Worker → R2 · "
    "Inngest → Buffer (primary publisher) · API v1 → Upstash rate limit.",
    fontsize=9, color="#4B5563", ha="left", va="center",
    style="italic",
)

# --------------------------------------------------------------------------
# Save
# --------------------------------------------------------------------------

REPO = Path(__file__).resolve().parent.parent
out_dir = REPO / "docs"
out_dir.mkdir(exist_ok=True)
out_path = out_dir / "architecture.png"

fig.tight_layout()
fig.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="white")
print(f"Saved: {out_path}")
