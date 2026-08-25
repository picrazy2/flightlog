import { useStatContext } from "@/stats/context";
import { moduleById } from "@/stats/registry";
import { yearMapEncoding, routeFirstYearMapEncoding } from "@/stats/yearEncoding";
import { useStore } from "@/state/store";
import { MapHost } from "./MapHost";
import { ControlBar } from "./ControlBar";
import { StatCardsRow } from "./StatCardsRow";
import { DetailPanelHost } from "./DetailPanelHost";
import { DatabaseModal } from "./db/DatabaseModal";
import { AboutModal } from "./AboutModal";
import { NorthButton } from "./NorthButton";
import { SplashScreen } from "./SplashScreen";
import { MobileShell } from "./mobile/MobileShell";
import { Legend } from "@/components/ui/Legend";
import { Button } from "@/components/ui/Button";
import { useFlightTracks } from "@/data/useFlightTracks";
import { useIsMobile } from "@/lib/useIsMobile";
import { useEffect, useRef, useState } from "react";

// Visit with ?splash to hold the intro for a few seconds (to preview the animation).
const wantSplashPreview = () =>
  typeof window !== "undefined" && /(?:[?&]|#).*splash/.test(window.location.search + window.location.hash);

const SPLASH_DELAY = 450; // blank dark screen before the intro fades in
const SPLASH_MIN = 1300; // once the intro is shown, keep it at least this long (≈ its run)

// Decides whether the splash is on screen. While `active`, it's shown. When `active`
// clears: hide immediately if we never crossed SPLASH_DELAY (fast load → no flash), else
// linger until the intro has had its minimum run so it never cuts off mid-animation.
function useSplashGate(active: boolean) {
  const [visible, setVisible] = useState(active);
  const start = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  useEffect(() => {
    if (active) {
      setVisible(true);
      return;
    }
    const elapsed = performance.now() - start.current;
    if (elapsed < SPLASH_DELAY) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(false), Math.max(0, SPLASH_DELAY + SPLASH_MIN - elapsed));
    return () => clearTimeout(t);
  }, [active]);
  return visible;
}

export function App() {
  const { ctx, isLoading, error } = useStatContext();
  const activeId = useStore((s) => s.activeModuleId);
  const showTracks = useStore((s) => s.settings.showTracks);
  const dbOpen = useStore((s) => s.dbOpen);
  const aboutOpen = useStore((s) => s.aboutOpen);
  const immersive = useStore((s) => s.immersive);
  const toggleImmersive = useStore((s) => s.toggleImmersive);
  const isMobile = useIsMobile();
  const [held, setHeld] = useState(wantSplashPreview);
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(false), 3500);
    return () => clearTimeout(t);
  }, [held]);
  // Start the tracks fetch now (parallel with flights) instead of when the map mounts,
  // and when tracks are on keep the splash up until they're in — so the map appears
  // complete rather than popping the tracks in a moment later.
  const tracks = useFlightTracks();
  const splashVisible = useSplashGate(held || isLoading || (showTracks && tracks.isLoading));

  if (error) {
    return (
      <div className="grid h-full place-items-center text-ink-muted">
        Failed to load flights. Check VITE_SUPABASE_* in .env.local.
      </div>
    );
  }
  if (splashVisible) return <SplashScreen />;
  if (!ctx) return <div className="grid h-full place-items-center text-ink-muted">No data</div>;

  // no active stat panel: colour by year when tracks are on, else dom/intl binary
  // No module active: colour by year either way, so toggling tracks changes the geometry
  // and not the meaning of the colours. Tracks on colours each flight by its own year;
  // tracks off colours each route by the year it was first flown, since the flights on a
  // route collapse onto one line. Domestic/international is still available as its own
  // stat module.
  const encoding = moduleById(activeId)?.map ?? (showTracks ? yearMapEncoding : routeFirstYearMapEncoding);
  const legend = encoding?.legend?.(ctx);

  const onFullscreen = () => {
    toggleImmersive();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  const fsButton = (
    <Button
      variant="secondary"
      size="md"
      iconOnly
      aria-label={immersive ? "Exit fullscreen" : "Fullscreen"}
      title={immersive ? "Exit fullscreen" : "Fullscreen map"}
      onClick={onFullscreen}
    >
      {immersive ? "✕" : "⛶"}
    </Button>
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapHost ctx={ctx} encoding={encoding} isMobile={isMobile} />

      {isMobile ? (
        <MobileShell ctx={ctx} encoding={encoding} />
      ) : !immersive ? (
        <>
          {/* top chrome */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-3 p-4">
            <ControlBar ctx={ctx} />
            <StatCardsRow ctx={ctx} />
            <div className="flex items-start justify-end gap-3">
              <div className="pointer-events-auto flex shrink-0 flex-col gap-2">
                {fsButton}
                <NorthButton />
              </div>
            </div>
          </div>

          {/* bottom-left detail panel */}
          <div className="pointer-events-none absolute bottom-4 left-4 z-20">
            <DetailPanelHost ctx={ctx} />
          </div>

          {/* bottom-right legend */}
          {legend && (
            <div className="pointer-events-auto absolute bottom-4 right-4 z-10">
              <Legend model={legend} />
            </div>
          )}
        </>
      ) : (
        /* desktop immersive: exit + reset-north */
        <div className="pointer-events-auto absolute right-4 top-4 z-30 flex flex-col gap-2">
          {fsButton}
          <NorthButton />
        </div>
      )}

      {dbOpen && <DatabaseModal />}
      {aboutOpen && <AboutModal />}
    </div>
  );
}
