import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { LogoMark } from "@/components/ui/Logo";
import { Icon, Chevron, type IconName } from "@/components/ui/Icon";
import { useStore } from "@/state/store";

const FEATURES: { icon: IconName; color: string; title: string; desc: string }[] = [
  { icon: "globe", color: "#5B9DFF", title: "Interactive map", desc: "Great-circle routes and real flown tracks on a globe or flat map, coloured by any dimension." },
  { icon: "growth", color: "#2DD4BF", title: "Deep statistics", desc: "Airports, cities, countries, airlines, aircraft, routes, cabins, delays, cost — each its own panel." },
  { icon: "filter", color: "#A78BFA", title: "Filter & search", desc: "Click almost anything to filter every chart and the map at once, search for any flight, airport or route, and drill into any year." },
  { icon: "calendar", color: "#22D3EE", title: "Period comparison", desc: "Every stat shows a ▲/▼ delta vs the previous period, your whole past, or what your upcoming flights will add." },
  { icon: "dollar-symbol", color: "#FFC061", title: "Cost & points", desc: "Cash and award spend per booking, in any display currency at the historical rate on the day you flew." },
  { icon: "wall-clock", color: "#34D399", title: "Punctuality", desc: "Departure & arrival delays, on-time rates, and your most- and least-delayed flights." },
  { icon: "mail", color: "#FB7185", title: "Hands-off email import", desc: "AI reads your booking & check-in emails and adds flights automatically — no forwarding or data entry." },
];

function Method({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="font-medium text-ink">{label}.</span> <span>{children}</span>
    </div>
  );
}

// "About Journia" — brand hero, the why, a card tour of features, and how the numbers work.
export function AboutModal() {
  const setAboutOpen = useStore((s) => s.setAboutOpen);
  const [methodOpen, setMethodOpen] = useState(false);
  return (
    <Modal title="About" onClose={() => setAboutOpen(false)} className="w-[min(760px,95vw)]">
      <div className="flex flex-col gap-7 p-6">
        {/* hero — the mark, big and centred */}
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoMark size={112} />
          <div>
            <div className="font-display text-[2.1rem] font-bold leading-none tracking-[-0.02em] text-ink">Journia</div>
            <p className="mt-2 text-label text-ink-muted">A customizable map &amp; analytics for everywhere you've flown.</p>
          </div>
        </div>

        {/* the why */}
        <p className="text-label leading-relaxed text-ink-muted">
          I'm passionate about aviation and love to travel. The app{" "}
          <span className="text-ink">Flighty</span> is what made me fall for tracking my flights, but I wanted
          something I could bend to my own curiosity, where every chart is cross-filterable, every metric is
          switchable, and every fare and point is accounted for. <span className="text-ink">Journia</span> is that
          personal flight log, with the whole map and every statistic reshaping themselves around whatever I'm
          curious about.
        </p>

        {/* what it does — feature cards */}
        <div className="flex flex-col gap-3">
          <div className="text-eyebrow tracking-[0.01em] text-ink-faint">What it does</div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-3 rounded-xl border border-border bg-surface-1 p-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${f.color}22` }}>
                  <Icon name={f.icon} size={16} color={f.color} />
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-label font-semibold text-ink">{f.title}</span>
                  <span className="text-caption leading-relaxed text-ink-muted">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* how the numbers work — expandable */}
        <div className="overflow-hidden rounded-xl border border-border">
          <button
            onClick={() => setMethodOpen((o) => !o)}
            className="focus-ring flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-label font-medium text-ink hover:bg-surface-2"
          >
            <span>How the numbers work</span>
            <Chevron dir={methodOpen ? "up" : "down"} size={12} color="var(--ink-faint)" />
          </button>
          {methodOpen && (
            <div className="flex flex-col gap-2.5 border-t border-border px-3.5 py-3 text-caption leading-relaxed text-ink-muted">
              <Method label="Connections">An arrival and the next departure from the same airport within 16 hours count as one visit, not two — using airline-scheduled times when available.</Method>
              <Method label="Points vs cash">An award booking with under $30 cash per segment is “points only”; $30 or more is “points + cash”.</Method>
              <Method label="Premium">“Premium” cabins are premium economy, business, and first; the headline is the share of flight time spent in them.</Method>
              <Method label="Distance">Great-circle between airports, or the actual flown path when a track is available.</Method>
              <Method label="Currency">Cash is converted to your display currency at the historical rate on the flight date.</Method>
              <div className="border-t border-border pt-2.5 text-ink-faint">
                Data: airports &amp; countries from OurAirports, airlines from OpenFlights, continents &amp; regions
                derived from country codes, aircraft from an open type database, exchange rates from the
                @fawazahmed0 currency API, and flight schedules, actual times &amp; flown tracks from AeroAPI
                (FlightAware).
              </div>
            </div>
          )}
        </div>

        {/* contact */}
        <p className="text-center text-caption text-ink-faint">
          Want to use Journia? Reach out at{" "}
          <a href="mailto:alexanderguo99@gmail.com" className="text-accent hover:underline">alexanderguo99@gmail.com</a>.
        </p>
      </div>
    </Modal>
  );
}
