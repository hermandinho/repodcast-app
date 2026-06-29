"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { createClientAction, updateClientAction } from "@/app/(dashboard)/clients/actions";
import { ArtworkUpload } from "./artwork-upload";

/**
 * Customer client form (post-hierarchy refactor). Creates / edits a
 * `Client` row — the parent entity that owns one or more `Show`s. Shows
 * themselves have their own modal (`<ShowFormModal>`).
 */
type CreateMode = { mode: "create" };
type EditMode = {
  mode: "edit";
  clientId: string;
  initial: {
    name: string;
    description: string | null;
    contactName: string | null;
    contactEmail: string | null;
    artworkUrl: string | null;
  };
};

export type ClientFormModalProps = (CreateMode | EditMode) & {
  open: boolean;
  onClose: () => void;
};

const DESCRIPTION_MAX = 280;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Outer wrapper keeps `<Modal>` mounted so the dialog can animate close,
 * while remounting the form body on each open. Hydrating state from props
 * via `useState` initializers in the body avoids the `setState`-in-effect
 * pattern flagged by `react-hooks/set-state-in-effect`.
 */
export function ClientFormModal(props: ClientFormModalProps) {
  const ariaLabel = props.mode === "create" ? "New client" : "Edit client";
  return (
    <Modal open={props.open} onClose={props.onClose} ariaLabel={ariaLabel}>
      {props.open && <ClientFormBody {...props} />}
    </Modal>
  );
}

function ClientFormBody(props: ClientFormModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial =
    props.mode === "edit"
      ? props.initial
      : {
          name: "",
          description: null,
          contactName: null,
          contactEmail: null,
          artworkUrl: null,
        };

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [contactName, setContactName] = useState(initial.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(initial.contactEmail ?? "");
  const [artworkUrl, setArtworkUrl] = useState(initial.artworkUrl ?? "");
  const [emailTouched, setEmailTouched] = useState(false);

  const trimmedName = name.trim();
  const trimmedEmail = contactEmail.trim();
  const emailValid = trimmedEmail === "" || EMAIL_RE.test(trimmedEmail);
  const canSubmit = trimmedName.length > 0 && emailValid && !pending;

  const submit = () => {
    setError(null);
    if (!trimmedName) {
      setError("Client name is required.");
      return;
    }
    if (!emailValid) {
      setEmailTouched(true);
      setError("Contact email looks invalid.");
      return;
    }
    const payload = {
      name: trimmedName,
      description: description.trim() || undefined,
      contactName: contactName.trim() || undefined,
      contactEmail: trimmedEmail || undefined,
      // In edit mode, send null to clear; in create mode, omit when empty.
      artworkUrl:
        artworkUrl.trim() === "" ? (props.mode === "edit" ? null : undefined) : artworkUrl.trim(),
    };

    startTransition(async () => {
      try {
        const result =
          props.mode === "create"
            ? await createClientAction(payload)
            : await updateClientAction({ clientId: props.clientId, ...payload });
        if (!result.ok) {
          setError(result.error);
          return;
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

  // Cmd/Ctrl+Enter to submit from any field.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canSubmit) submit();
    }
  };

  const isCreate = props.mode === "create";
  const title = isCreate ? "New client" : "Edit client";
  const headerDescription = isCreate
    ? "Clients are the agencies and companies you produce content for. Each client can own multiple shows."
    : "Update client details. Shows and episodes under this client aren't affected.";

  return (
    <form onSubmit={onSubmit} onKeyDown={onKeyDown}>
      <ModalHeader title={title} description={headerDescription} onClose={props.onClose} />

      <ModalBody className="flex flex-col gap-5">
        <Preview
          name={trimmedName}
          description={description.trim()}
          contactName={contactName.trim()}
          artworkUrl={artworkUrl.trim()}
        />

        <Section
          title="Brand"
          description="Optional — a logo or photo shown across the client's cards and detail pages."
        >
          <ArtworkUpload value={artworkUrl} onChange={setArtworkUrl} />
        </Section>

        <Section title="Basics">
          <Field label="Client name" htmlFor="client-name" required>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Northwind Media"
              autoFocus
              maxLength={120}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="client-description"
            hint="What kind of work you do for them. Shown on the client card."
            counter={`${description.length}/${DESCRIPTION_MAX}`}
          >
            <Textarea
              id="client-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder="Independent podcast network with three flagship shows."
              className="h-[78px]"
              maxLength={DESCRIPTION_MAX}
            />
          </Field>
        </Section>

        <Section title="Primary contact" description="Optional — who you talk to on this account.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact name" htmlFor="client-contact-name">
              <Input
                id="client-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Avery Lin"
                autoComplete="off"
              />
            </Field>

            <Field
              label="Contact email"
              htmlFor="client-contact-email"
              error={emailTouched && !emailValid ? "Doesn't look like an email." : undefined}
            >
              <Input
                id="client-contact-email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                placeholder="avery@northwind.media"
                type="email"
                autoComplete="off"
                style={
                  emailTouched && !emailValid
                    ? { border: "1px solid #E5A4A0", background: "#FDF6F5" }
                    : undefined
                }
                aria-invalid={emailTouched && !emailValid ? true : undefined}
              />
            </Field>
          </div>
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
            {pending ? "Saving…" : isCreate ? "Create client" : "Save changes"}
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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border bg-canvas text-muted inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border px-[5px] font-mono text-[10.5px]">
      {children}
    </kbd>
  );
}

/* ============================================================
   Live preview — mirrors the card on /clients
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
  description,
  contactName,
  artworkUrl,
}: {
  name: string;
  description: string;
  contactName: string;
  artworkUrl: string;
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
            {empty ? "Client name" : name}
          </div>
          <div className="text-muted-2 mt-[2px] truncate text-[12.5px]">
            {contactName || (empty ? "Contact appears here" : "No contact yet")}
          </div>
        </div>
      </div>
      {description && (
        <p className="text-muted mt-3 line-clamp-2 text-[12.5px] leading-[1.5]">{description}</p>
      )}
    </div>
  );
}
