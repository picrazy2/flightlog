import { Popover } from "@/components/ui/Popover";
import { Switch } from "@/components/ui/Switch";
import { Icon } from "@/components/ui/Icon";
import { LogoMark } from "@/components/ui/Logo";
import { CurrencyInline } from "@/components/ui/CurrencyPicker";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1.5">
      <span className="text-label text-ink">{label}</span>
      {children}
    </div>
  );
}

// Desktop gear menu: map/display preferences + About. The Add button and user switcher
// stay outside this menu (kept visible in the control bar).
export function SettingsMenu() {
  const { settings, setSettings, projection, toggleProjection, setAboutOpen } = useStore();
  const km = settings.units === "km";

  return (
    <Popover
      align="end"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          aria-label="Settings"
          title="Settings"
          className={cn("focus-ring grid h-9 w-9 place-items-center rounded-full", open ? "bg-surface-2" : "hover:bg-surface-2")}
        >
          <Icon name="setting" size={18} color={open ? "var(--accent)" : "currentColor"} />
        </button>
      )}
    >
      {(close) => (
        <div className="w-[240px]">
          <div className="mb-1 px-1 text-eyebrow tracking-[0.01em] text-ink-faint">Map &amp; display</div>
          <Row label="Tracks">
            <Switch checked={settings.showTracks} onChange={(v) => setSettings({ showTracks: v })} />
          </Row>
          {settings.showTracks && (
            <Row label="Mark estimated">
              <Switch checked={settings.markEstimated} onChange={(v) => setSettings({ markEstimated: v })} />
            </Row>
          )}
          <Row label="Kilometres">
            <Switch checked={km} onChange={(v) => setSettings({ units: v ? "km" : "mi" })} />
          </Row>
          <Row label="Globe">
            <Switch checked={projection === "globe"} onChange={toggleProjection} />
          </Row>
          <CurrencyInline />

          <div className="my-2 h-px bg-border" />
          <button
            onClick={() => {
              setAboutOpen(true);
              close();
            }}
            className="focus-ring flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-label text-ink hover:bg-surface-2"
          >
            <LogoMark size={18} />
            About Journia
          </button>
        </div>
      )}
    </Popover>
  );
}
