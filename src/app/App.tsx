import { useStatContext } from "@/stats/context";
import { moduleById, defaultEncodingModule } from "@/stats/registry";
import { yearMapEncoding } from "@/stats/yearEncoding";
import { useStore } from "@/state/store";
import { MapHost } from "./MapHost";
import { ControlBar } from "./ControlBar";
import { StatCardsRow } from "./StatCardsRow";
import { DetailPanelHost } from "./DetailPanelHost";
import { DatabaseModal } from "./db/DatabaseModal";
import { AboutModal } from "./AboutModal";
import { SplashScreen } from "./SplashScreen";
import { MobileShell } from "./mobile/MobileShell";
import { Legend } from "@/components/ui/Legend";
import { Button } from "@/components/ui/Button";
import { useIsMobile } from "@/lib/useIsMobile";

export function App() {
  const { ctx, isLoading, error } = useStatContext();
  const activeId = useStore((s) => s.activeModuleId);
  const showTracks = useStore((s) => s.settings.showTracks);
  const dbOpen = useStore((s) => s.dbOpen);
  const aboutOpen = useStore((s) => s.aboutOpen);
  const immersive = useStore((s) => s.immersive);
  const toggleImmersive = useStore((s) => s.toggleImmersive);
  const isMobile = useIsMobile();

  if (error) {
    return (
      <div className="grid h-full place-items-center text-ink-muted">
        Failed to load flights. Check VITE_SUPABASE_* in .env.local.
      </div>
    );
  }
  if (!ctx) {
    return isLoading ? (
      <SplashScreen loading />
    ) : (
      <div className="grid h-full place-items-center text-ink-muted">No data</div>
    );
  }

  // no active stat panel: colour by year when tracks are on, else dom/intl binary
  const encoding = moduleById(activeId)?.map ?? (showTracks ? yearMapEncoding : defaultEncodingModule.map);
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
              <div className="pointer-events-auto shrink-0">{fsButton}</div>
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
        /* desktop immersive: exit button only */
        <div className="pointer-events-auto absolute right-4 top-4 z-30">{fsButton}</div>
      )}

      {dbOpen && <DatabaseModal />}
      {aboutOpen && <AboutModal />}
    </div>
  );
}
