"use client";

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="rounded-pill relative h-6 w-[42px] flex-shrink-0 transition-colors"
      style={{ background: checked ? "var(--color-accent)" : "#D3DAE6" }}
    >
      <span
        className="absolute top-[3px] block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left]"
        style={{ left: checked ? "21px" : "3px" }}
      />
    </button>
  );
}
