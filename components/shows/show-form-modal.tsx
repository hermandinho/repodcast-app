"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { ArtworkUpload } from "@/components/clients/artwork-upload";
import { PlanLimitBanner, type PlanLimitCapacity } from "@/components/billing/plan-limit-banner";
import { createShowAction, updateShowAction } from "@/app/(dashboard)/shows/actions";

/**
 * Show form. Creates / edits a `Show` row — a single podcast that belongs
 * to a parent `Client`. Mirrors `<ClientFormModal>`'s sectioned layout,
 * live preview, validation, artwork upload, and submit gating.
 */
export type ShowClientOption = { id: string; name: string };

type CreateMode = {
  mode: "create";
  /** Client list for the picker. Required even when only one exists. */
  clients: ShowClientOption[];
  /** Preselected client id (e.g. when opening from a client detail page). */
  defaultClientId?: string;
  /** Current shows-vs-cap usage; null in sample-data mode. */
  capacity?: PlanLimitCapacity | null;
};
type EditMode = {
  mode: "edit";
  showId: string;
  initial: {
    name: string;
    host: string;
    description: string | null;
    artworkUrl: string | null;
    rssUrl: string | null;
    clientId: string;
    clientName: string;
  };
};

export type ShowFormModalProps = (CreateMode | EditMode) & {
  open: boolean;
  onClose: () => void;
};

const DESCRIPTION_MAX = 280;
const URL_RE = /^https?:\/\/[^\s]+$/i;

/**
 * Outer wrapper keeps `<Modal>` mounted (so the dialog can animate close)
 * while remounting the form body on each open. Hydrating state from props
 * via `useState` initializers in the body avoids the `setState`-in-effect
 * pattern flagged by `react-hooks/set-state-in-effect`.
 */
export function ShowFormModal(props: ShowFormModalProps) {
  const ariaLabel = props.mode === "create" ? "New show" : "Edit show";
  return (
    <Modal open={props.open} onClose={props.onClose} ariaLabel={ariaLabel}>
      {props.open && <ShowFormBody {...props} />}
    </Modal>
  );
}

function ShowFormBody(props: ShowFormModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial =
    props.mode === "edit"
      ? props.initial
      : {
          clientId: props.defaultClientId ?? props.clients[0]?.id ?? "",
          name: "",
          host: "",
          description: null,
          artworkUrl: null,
          rssUrl: null,
        };

  const [clientId, setClientId] = useState(initial.clientId);
  const [name, setName] = useState(initial.name);
  const [host, setHost] = useState(initial.host);
  const [description, setDescription] = useState(initial.description ?? "");
  const [artworkUrl, setArtworkUrl] = useState(initial.artworkUrl ?? "");
  const [rssUrl, setRssUrl] = useState(initial.rssUrl ?? "");
  const [rssTouched, setRssTouched] = useState(false);

  const trimmedName = name.trim();
  const trimmedHost = host.trim();
  const trimmedRss = rssUrl.trim();
  const rssValid = trimmedRss === "" || URL_RE.test(trimmedRss);
  const canSubmit =
    trimmedName.length > 0 && trimmedHost.length > 0 && clientId.length > 0 && rssValid && !pending;

  const submit = () => {
    setError(null);
    if (!trimmedName) {
      setError("Show name is required.");
      return;
    }
    if (!trimmedHost) {
      setError("Host name is required.");
      return;
    }
    if (!clientId) {
      setError("Pick a client to attach this show to.");
      return;
    }
    if (!rssValid) {
      setRssTouched(true);
      setError("RSS URL must start with http:// or https://.");
      return;
    }

    startTransition(async () => {
      try {
        if (props.mode === "create") {
          const payload = {
            clientId,
            name: trimmedName,
            host: trimmedHost,
            description: description.trim() || undefined,
            artworkUrl: artworkUrl.trim() || undefined,
            rssUrl: trimmedRss || undefined,
          };
          const result = await createShowAction(payload);
          if (!result.ok) {
            setError(result.error);
            return;
          }
        } else {
          // Edit mode never re-parents — we omit clientId so the partial
          // update schema accepts the payload.
          const payload = {
            showId: props.showId,
            name: trimmedName,
            host: trimmedHost,
            description: description.trim() || null,
            artworkUrl: artworkUrl.trim() === "" ? null : artworkUrl.trim(),
            rssUrl: trimmedRss === "" ? null : trimmedRss,
          };
          const result = await updateShowAction(payload);
          if (!result.ok) {
            setError(result.error);
            return;
          }
        }
        router.refresh();
        props.onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit) submit();
    }
  };

  const isCreate = props.mode === "create";
  const title = isCreate ? "New show" : "Edit show";
  const headerDescription = isCreate
    ? "A show is one podcast. Each show has its own host and voice profile, even when multiple shows share a client."
    : "Update show details. Episodes and voice samples under this show aren't affected.";

  // Client picker rendering: in create mode we show a real picker. If only
  // one client exists OR `defaultClientId` was passed, render it locked to
  // avoid the user accidentally re-parenting on submit.
  const clientList = isCreate ? props.clients : [];
  const lockedClientName = isCreate
    ? (clientList.find((c) => c.id === clientId)?.name ?? "")
    : props.initial.clientName;
  const showClientPicker = isCreate && clientList.length > 1 && !props.defaultClientId;

  return (
    <form onSubmit={onSubmit} onKeyDown={onKeyDown}>
      <ModalHeader title={title} description={headerDescription} onClose={props.onClose} />

      <ModalBody className="flex flex-col gap-5">
        {isCreate && props.mode === "create" && (
          <PlanLimitBanner capacity={props.capacity ?? null} />
        )}
        <Preview
          name={trimmedName}
          host={trimmedHost}
          description={description.trim()}
          artworkUrl={artworkUrl.trim()}
          clientName={lockedClientName}
        />

        <Section
          title="Brand"
          description="Optional — show artwork is reused on cards, episode pages, and exported assets."
        >
          <ArtworkUpload value={artworkUrl} onChange={setArtworkUrl} />
        </Section>

        <Section title="Basics">
          {isCreate && (
            <Field label="Client" htmlFor="show-client" required>
              {showClientPicker ? (
                <select
                  id="show-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full rounded-[10px] px-[14px] py-3 font-sans text-[13px] text-[#2A3550] outline-none focus:border-[#C7D2E6]"
                  style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
                >
                  {clientList.length === 0 && (
                    <option value="">No clients yet — create one first</option>
                  )}
                  {clientList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <LockedField value={lockedClientName || "No client selected"} />
              )}
            </Field>
          )}

          <Field label="Show name" htmlFor="show-name" required>
            <Input
              id="show-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Founder's Frequency"
              autoFocus
              maxLength={120}
            />
          </Field>

          <Field
            label="Host"
            htmlFor="show-host"
            required
            hint="The person whose voice the engine learns to write in."
          >
            <Input
              id="show-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Maya Chen"
              maxLength={120}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="show-description"
            hint="One line. Shown under the show name on the dashboard."
            counter={`${description.length}/${DESCRIPTION_MAX}`}
          >
            <Textarea
              id="show-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder="Interviews with founders about the messy middle — pricing, hiring, focus."
              className="h-[72px]"
              maxLength={DESCRIPTION_MAX}
            />
          </Field>
        </Section>

        <Section
          title="Connect"
          description="Optional — link an RSS feed to auto-import new episodes later."
        >
          <Field
            label="RSS feed URL"
            htmlFor="show-rss"
            error={rssTouched && !rssValid ? "Must start with http:// or https://" : undefined}
          >
            <Input
              id="show-rss"
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              onBlur={() => setRssTouched(true)}
              placeholder="https://feeds.example.com/the-founders-frequency"
              type="url"
              autoComplete="off"
              style={
                rssTouched && !rssValid
                  ? { border: "1px solid #E5A4A0", background: "#FDF6F5" }
                  : undefined
              }
              aria-invalid={rssTouched && !rssValid ? true : undefined}
            />
          </Field>
        </Section>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md bg-[#FBF1DE] px-3 py-[10px] font-sans text-[12.5px] font-medium text-[#A06D12]"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              className="mt-[2px] flex-shrink-0"
            >
              <circle cx="6.5" cy="6.5" r="5.5" />
              <path d="M6.5 4v3M6.5 9v.01" />
            </svg>
            <span>{error}</span>
          </div>
        )}
      </ModalBody>

      <ModalFooter className="justify-between">
        <span className="text-muted-2 hidden font-sans text-[11.5px] sm:inline">
          Press <Kbd>⌘</Kbd> + <Kbd>Enter</Kbd> to save
        </span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" type="button" onClick={props.onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? "Saving…" : isCreate ? "Create show" : "Save changes"}
          </Button>
        </div>
      </ModalFooter>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-muted-2 font-sans text-[11px] font-semibold tracking-[0.08em] uppercase">
          {title}
        </div>
        {description && <p className="text-muted-2 mt-[3px] text-[12px]">{description}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  required,
  counter,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  counter?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-[6px]">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-ink font-sans text-[12.5px] font-semibold">
          {label}
          {required && <span className="ml-1 text-[#C0392B]">*</span>}
        </span>
        {counter && <span className="text-muted-2 font-mono text-[10.5px]">{counter}</span>}
      </span>
      {children}
      {error ? (
        <span className="text-[11.5px] font-medium text-[#C0392B]">{error}</span>
      ) : hint ? (
        <span className="text-muted-2 text-[11.5px]">{hint}</span>
      ) : null}
    </label>
  );
}

function LockedField({ value }: { value: string }) {
  return (
    <div
      className="text-muted w-full rounded-[10px] px-[14px] py-3 font-sans text-[13px]"
      style={{ border: "1px solid #E6EBF3", background: "#F7F9FC" }}
    >
      {value}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border bg-canvas text-muted inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border px-[5px] font-mono text-[10.5px]">
      {children}
    </kbd>
  );
}

/* ============================================================
   Live preview — mirrors the card on /shows
   ============================================================ */

const AVATAR_PALETTE = ["#3A5BA0", "#2E9E5B", "#7A4FB0", "#A06D12", "#C0392B"];

function colorForName(name: string): string {
  if (!name) return "#C9D4E8";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function Preview({
  name,
  host,
  description,
  artworkUrl,
  clientName,
}: {
  name: string;
  host: string;
  description: string;
  artworkUrl: string;
  clientName: string;
}) {
  const empty = name.length === 0;
  const avatarBg = useMemo(() => colorForName(name), [name]);
  const initial = useMemo(() => initialsOf(name), [name]);

  return (
    <div className="border-border bg-canvas rounded-2xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-muted-2 font-sans text-[10.5px] font-semibold tracking-[0.1em] uppercase">
          Preview
        </span>
        {empty && <span className="text-muted-2 font-sans text-[11px]">Updates as you type</span>}
      </div>
      <div className="flex items-center gap-3">
        {artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artworkUrl}
            alt=""
            className="h-12 w-12 flex-shrink-0 rounded-xl object-cover"
            style={{ background: "#EEF1F6" }}
          />
        ) : (
          <div
            className="font-display flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white transition-colors"
            style={{ background: avatarBg, opacity: empty ? 0.35 : 1 }}
          >
            {empty ? "?" : initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className={[
              "font-display truncate text-[16px] leading-tight font-semibold",
              empty ? "text-muted-2" : "text-ink",
            ].join(" ")}
          >
            {empty ? "Show name" : name}
          </div>
          <div className="text-muted-2 mt-[2px] truncate text-[12.5px]">
            {host ? `Hosted by ${host}` : "Host appears here"}
            {clientName && (
              <>
                <span className="text-[#CBD4E2]"> · </span>
                <span className="text-muted">{clientName}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {description && (
        <p className="text-muted mt-3 line-clamp-2 text-[12.5px] leading-[1.5]">{description}</p>
      )}
    </div>
  );
}
