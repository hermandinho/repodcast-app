import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-[30px] pt-[28px] pb-[60px]">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-5">
          <h1 className="font-display text-ink text-[25px] font-semibold tracking-[-0.5px]">
            Settings
          </h1>
          <p className="text-muted mt-[6px] text-[14px]">Workspace, billing, team, and branding.</p>
        </div>
        <SettingsNav />
        {children}
      </div>
    </div>
  );
}
