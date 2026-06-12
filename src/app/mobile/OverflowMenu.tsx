import { Popover } from "@/components/ui/Popover";
import { Switch } from "@/components/ui/Switch";
import { Icon } from "@/components/ui/Icon";
import { CurrencyInline } from "@/components/ui/CurrencyPicker";
import { useStore } from "@/state/store";
import { useUsers } from "@/data/useUsers";
import { cn } from "@/lib/cn";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1.5">
      <span className="text-label text-ink">{label}</span>
      {children}
    </div>
  );
}

// Mobile overflow: map/display toggles (one per row), an Add action that opens the
// database modal, and the user switcher.
export function OverflowMenu() {
  const { settings, setSettings, projection, toggleProjection, setDbOpen, userId, setUserId } = useStore();
  const { data: users = [] } = useUsers();
  const km = settings.units === "km";

  return (
    <Popover
      align="end"
      trigger={({ toggle, open }) => (
        <button
          onClick={toggle}
          aria-label="Menu"
          className={cn("focus-ring flex h-9 w-9 flex-col items-center justify-center gap-[3px] rounded-full text-ink", open ? "bg-surface-2" : "hover:bg-surface-2")}
        >
          <span className="h-[1.5px] w-[18px] rounded-full bg-current" />
          <span className="h-[1.5px] w-[18px] rounded-full bg-current" />
          <span className="h-[1.5px] w-[18px] rounded-full bg-current" />
        </button>
      )}
    >
      {(close) => (
        <div className="w-[250px]">
          <div className="mb-1 px-1 text-eyebrow tracking-[0.01em] text-ink-faint">Map &amp; display</div>
          <Row label="Tracks">
            <Switch checked={settings.showTracks} onChange={(v) => setSettings({ showTracks: v })} />
          </Row>
          {settings.showTracks && (
            <Row label="Estimated paths">
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
              setDbOpen(true);
              close();
            }}
            className="focus-ring flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-label text-ink hover:bg-surface-2"
          >
            <Icon name="add" size={16} color="var(--accent)" />
            Add flights &amp; data
          </button>

          <div className="my-2 h-px bg-border" />
          <div className="mb-1 px-1 text-eyebrow tracking-[0.01em] text-ink-faint">Switch log</div>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                setUserId(u.id);
                close();
              }}
              className={cn("focus-ring flex w-full items-center justify-between rounded-md px-1 py-1.5 text-label hover:bg-surface-2", u.id === userId ? "text-accent" : "text-ink")}
            >
              {u.name}
              {u.id === userId && <span className="text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
