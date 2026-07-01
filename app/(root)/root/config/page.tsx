import Link from "next/link";
import { LimitOverrideResource } from "@prisma/client";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  listAgencyLimitOverrides,
  listSystemConfig,
  type AgencyLimitOverrideRow,
  type SystemConfigRow,
} from "@/server/db/system/config";
import {
  deleteSystemConfigAction,
  revokeAgencyLimitOverrideAction,
  upsertAgencyLimitOverrideAction,
  upsertSystemConfigAction,
} from "./actions";

export const dynamic = "force-dynamic";

const RESOURCE_OPTIONS: readonly LimitOverrideResource[] = [
  "SHOWS",
  "MEMBERS",
  "EPISODES",
  "GENERATIONS",
];

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatIsoDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function stringifyJsonValue(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

const ERROR_COPY: Record<string, string> = {
  invalid: "Invalid input — check the JSON value and required fields.",
  forbidden: "This action requires a ROOT or OPERATOR system role.",
  not_found: "The record you were trying to edit no longer exists.",
  unknown: "Something went wrong. Check the server logs.",
};

export default async function RootConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; key?: string; agencyId?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSystemAdminContext();

  const canWrite = ctx.admin.role === "ROOT" || ctx.admin.role === "OPERATOR";

  const [configRows, overrides] = await Promise.all([
    listSystemConfig(ctx),
    listAgencyLimitOverrides(ctx, {}),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">Config</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Platform-wide key/value toggles and per-agency plan-limit overrides. Every mutation lands
          a{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            SystemAuditLog
          </code>{" "}
          row inside the same transaction. Writes require the{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            ROOT
          </code>{" "}
          or{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            OPERATOR
          </code>{" "}
          role.
        </p>
      </header>

      {sp.error ? (
        <Banner tone="error">
          {ERROR_COPY[sp.error] ?? ERROR_COPY.unknown}
          {sp.key ? ` (key: ${sp.key})` : null}
        </Banner>
      ) : null}
      {sp.ok ? <Banner tone="ok">Change applied.</Banner> : null}

      <SystemConfigSection rows={configRows} canWrite={canWrite} />

      <AgencyLimitOverridesSection overrides={overrides} canWrite={canWrite} />
    </div>
  );
}

// ============================================================
// SystemConfig
// ============================================================

function SystemConfigSection({ rows, canWrite }: { rows: SystemConfigRow[]; canWrite: boolean }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Platform config</h2>
        <span className="text-sm text-zinc-500">
          {rows.length} {rows.length === 1 ? "key" : "keys"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No config keys yet. Add one with the form below.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <SystemConfigCard key={row.id} row={row} canWrite={canWrite} />
          ))}
        </ul>
      )}

      {canWrite ? <SystemConfigUpsertForm /> : <WriteGateNotice />}
    </section>
  );
}

function SystemConfigCard({ row, canWrite }: { row: SystemConfigRow; canWrite: boolean }) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-white">{row.key}</span>
              {row.description ? (
                <span className="truncate text-[12px] text-zinc-500">— {row.description}</span>
              ) : null}
            </div>
            <div className="text-[11.5px] text-zinc-500">
              updated {formatIsoDateTime(row.updatedAt)}
              {row.updatedBy ? ` by ${row.updatedBy.name ?? row.updatedBy.email}` : ""}
            </div>
          </div>
          <span className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
            edit
          </span>
        </summary>

        <div className="border-t border-zinc-800 px-4 py-4">
          <pre className="mb-3 max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {stringifyJsonValue(row.value)}
          </pre>

          {canWrite ? (
            <div className="flex flex-col gap-3">
              <form action={upsertSystemConfigAction} className="flex flex-col gap-2">
                <input type="hidden" name="key" value={row.key} />
                <textarea
                  name="valueJson"
                  rows={4}
                  defaultValue={stringifyJsonValue(row.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[12px] text-zinc-100"
                />
                <input
                  type="text"
                  name="description"
                  defaultValue={row.description ?? ""}
                  placeholder="Description (optional)"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                />
                <input
                  type="text"
                  name="note"
                  placeholder="Audit note (recommended)"
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
                  >
                    Save
                  </button>
                </div>
              </form>

              <form action={deleteSystemConfigAction} className="flex items-center gap-2">
                <input type="hidden" name="key" value={row.key} />
                <input
                  type="text"
                  name="note"
                  required
                  minLength={3}
                  placeholder="Reason (required to delete)"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                />
                <button
                  type="submit"
                  className="rounded-md border border-red-900/60 px-3 py-2 text-sm text-red-300 hover:bg-red-950/50"
                >
                  Delete
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function SystemConfigUpsertForm() {
  return (
    <form
      action={upsertSystemConfigAction}
      className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
    >
      <h3 className="font-display text-sm font-semibold text-white">Add / update key</h3>
      <input
        type="text"
        name="key"
        required
        placeholder="UPPER_SNAKE_KEY"
        pattern="[A-Z0-9_]{2,64}"
        title="UPPER_SNAKE_CASE, 2-64 chars"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500"
      />
      <textarea
        name="valueJson"
        rows={4}
        required
        placeholder={'value as JSON — "string", 42, true, {"foo": 1}, [1,2]'}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[12px] text-zinc-100 placeholder:text-zinc-500"
      />
      <input
        type="text"
        name="description"
        placeholder="Description (optional)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
      />
      <input
        type="text"
        name="note"
        placeholder="Audit note (recommended)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-md border border-red-500/60 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
        >
          Create key
        </button>
      </div>
    </form>
  );
}

// ============================================================
// AgencyLimitOverride
// ============================================================

function AgencyLimitOverridesSection({
  overrides,
  canWrite,
}: {
  overrides: AgencyLimitOverrideRow[];
  canWrite: boolean;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">
          Agency plan-limit overrides
        </h2>
        <span className="text-sm text-zinc-500">
          {overrides.length} {overrides.length === 1 ? "override" : "overrides"}
        </span>
      </div>

      {overrides.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No overrides currently granted. Use the form below to comp an agency additional capacity —
          or to cap one below its plan.
        </div>
      ) : (
        <OverrideTable overrides={overrides} canWrite={canWrite} />
      )}

      {canWrite ? <AgencyLimitOverrideCreateForm /> : <WriteGateNotice />}
    </section>
  );
}

function OverrideTable({
  overrides,
  canWrite,
}: {
  overrides: AgencyLimitOverrideRow[];
  canWrite: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
          <tr className="border-b border-zinc-800">
            <th className="px-4 py-3">Agency</th>
            <th className="px-4 py-3">Resource</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3">Expires</th>
            <th className="px-4 py-3">By</th>
            <th className="px-4 py-3">Note</th>
            {canWrite ? <th className="px-4 py-3">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {overrides.map((o) => (
            <tr key={o.id} className="border-b border-zinc-800 last:border-0">
              <td className="px-4 py-3">
                <Link
                  href={`/root/agencies/${o.agencyId}`}
                  className="text-zinc-100 hover:text-white hover:underline"
                >
                  {o.agencyName}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-[11px] tracking-wider text-zinc-300 uppercase">
                {o.resource}
              </td>
              <td className="px-4 py-3 text-right text-white tabular-nums">
                {o.value.toLocaleString()}
              </td>
              <td className="px-4 py-3 font-mono text-[11px] text-zinc-400">
                {o.expiresAt ? (
                  <span className={o.isActive ? "text-zinc-300" : "text-zinc-600 line-through"}>
                    {formatIsoDate(o.expiresAt)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-[11.5px] text-zinc-400">{o.by.name ?? o.by.email}</td>
              <td className="px-4 py-3 text-[12px] text-zinc-400">{o.note ?? "—"}</td>
              {canWrite ? (
                <td className="px-4 py-3">
                  <form
                    action={revokeAgencyLimitOverrideAction}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="id" value={o.id} />
                    <input
                      type="text"
                      name="note"
                      required
                      minLength={3}
                      placeholder="Reason"
                      className="w-32 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11.5px] text-zinc-100 placeholder:text-zinc-500"
                    />
                    <button
                      type="submit"
                      className="rounded border border-red-900/60 px-2 py-1 text-[11.5px] text-red-300 hover:bg-red-950/50"
                    >
                      Revoke
                    </button>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgencyLimitOverrideCreateForm() {
  return (
    <form
      action={upsertAgencyLimitOverrideAction}
      className="grid grid-cols-1 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-6"
    >
      <h3 className="font-display text-sm font-semibold text-white md:col-span-6">
        Grant / update override
      </h3>
      <input
        type="text"
        name="agencyId"
        required
        placeholder="Agency id (agc_…)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-2"
      />
      <select
        name="resource"
        required
        defaultValue=""
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="" disabled>
          Resource
        </option>
        {RESOURCE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        type="number"
        name="value"
        required
        min={0}
        max={1_000_000}
        placeholder="New cap"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500"
      />
      <input
        type="date"
        name="expiresAt"
        title="Optional — leave blank for indefinite"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      />
      <button
        type="submit"
        className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
      >
        Save
      </button>
      <input
        type="text"
        name="note"
        placeholder="Reason (recommended — surfaces in audit + row)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-6"
      />
    </form>
  );
}

// ============================================================
// Building blocks
// ============================================================

function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-900/60 bg-red-950/30 text-red-100"
      : "border-emerald-900/60 bg-emerald-950/30 text-emerald-100";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`} role="status">
      {children}
    </div>
  );
}

function WriteGateNotice() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-4 text-[12.5px] text-zinc-500">
      Your role can view but not write. Ask a ROOT or OPERATOR to make changes.
    </div>
  );
}
