import { UserButton } from "@clerk/nextjs";
import type { SystemAdminContext } from "@/server/auth/system";

type RootTopbarProps = {
  ctx: SystemAdminContext;
};

const ROLE_PILL_STYLE: Record<SystemAdminContext["admin"]["role"], string> = {
  ROOT: "bg-red-500/20 text-red-200 ring-red-400/40",
  OPERATOR: "bg-amber-500/20 text-amber-200 ring-amber-400/40",
  SUPPORT: "bg-sky-500/20 text-sky-200 ring-sky-400/40",
  ANALYST: "bg-zinc-500/20 text-zinc-200 ring-zinc-400/40",
};

export function RootTopbar({ ctx }: RootTopbarProps) {
  return (
    <header className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-red-900/40 bg-gradient-to-r from-red-950/80 via-red-950/40 to-zinc-900/80 px-6 text-white">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-red-500/30 px-3 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] uppercase ring-1 ring-red-400/50">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-300" />
          ROOT MODE
        </span>
        <span className="text-[13px] text-white/60">
          Platform admin · signed in as {ctx.user.email}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-[3px] font-mono text-[10.5px] font-semibold tracking-wider uppercase ring-1 ${
            ROLE_PILL_STYLE[ctx.admin.role]
          }`}
        >
          {ctx.admin.role}
        </span>
        <UserButton />
      </div>
    </header>
  );
}
