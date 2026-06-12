import { useStore } from "@/state/store";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Icon } from "@/components/ui/Icon";
import { CurrencyButton } from "@/components/ui/CurrencyPicker";

// Map/display actions, shown on the right of the control bar.
export function HeaderActions() {
  const { settings, setSettings, projection, toggleProjection, setDbOpen } = useStore();
  const km = settings.units === "km";
  const tracks = settings.showTracks;
  return (
    <div className="flex items-center gap-1.5">
      {/* tracks: prominent labelled toggle; estimated sub-toggle appears when on */}
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1">
        <Icon name="route" size={14} color={tracks ? "var(--accent)" : "currentColor"} />
        <span className="text-label text-ink">Tracks</span>
        <Switch checked={tracks} onChange={(v) => setSettings({ showTracks: v })} />
        {tracks && (
          <>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <span className="text-label text-ink-muted" title="Dash & thin great-circle / filler portions">Est.</span>
            <Switch checked={settings.markEstimated} onChange={(v) => setSettings({ markEstimated: v })} />
          </>
        )}
      </div>

      {/* display currency picker */}
      <CurrencyButton />

      {/* units: the label itself is the icon */}
      <Button
        variant="ghost"
        size="md"
        iconOnly
        aria-label={km ? "Switch to miles" : "Switch to kilometres"}
        title={km ? "Kilometres (tap for miles)" : "Miles (tap for kilometres)"}
        onClick={() => setSettings({ units: km ? "mi" : "km" })}
      >
        <span className="text-label font-semibold">{km ? "km" : "mi"}</span>
      </Button>

      <Button
        variant="ghost"
        size="md"
        iconOnly
        aria-label="Toggle globe / flat"
        title={projection === "globe" ? "Globe (tap for flat map)" : "Flat map (tap for globe)"}
        onClick={toggleProjection}
      >
        <Icon name="globe" color={projection === "globe" ? "var(--accent)" : "currentColor"} />
      </Button>

      <Button
        variant="ghost"
        size="md"
        iconOnly
        aria-label="Database"
        title="Database (flights, bookings, import)"
        onClick={() => setDbOpen(true)}
      >
        <Icon name="add" color="var(--accent)" />
      </Button>
    </div>
  );
}
