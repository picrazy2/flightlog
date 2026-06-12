import { Modal } from "@/components/ui/Modal";
import { LogoMark } from "@/components/ui/Logo";
import { useStore } from "@/state/store";

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-label font-semibold text-ink">{title}</span>
      <span className="text-label leading-relaxed text-ink-muted">{desc}</span>
    </li>
  );
}

// "About Journia" — the brand hero, the why, and a tour of what the app does.
export function AboutModal() {
  const setAboutOpen = useStore((s) => s.setAboutOpen);
  return (
    <Modal title="About" onClose={() => setAboutOpen(false)} className="w-[min(560px,95vw)]">
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
          I'm passionate about aviation. I fly as often as I can and love travel in general. The app{" "}
          <span className="text-ink">Flighty</span> is what made me fall for tracking my flights, but I wanted
          something I could bend to my own curiosity, where every chart is cross-filterable, every metric is
          switchable, and every fare and point is accounted for. <span className="text-ink">Journia</span> is that
          personal flight log, with the whole map and every statistic reshaping themselves around whatever I'm
          curious about.
        </p>

        {/* what it does */}
        <div className="flex flex-col gap-3">
          <div className="text-eyebrow tracking-[0.01em] text-ink-faint">What it does</div>
          <ul className="flex flex-col gap-3">
            <Feature title="Interactive map" desc="Great-circle routes and real flown tracks on a globe or flat map, coloured by any dimension you pick." />
            <Feature title="Deep statistics" desc="Airports, cities, countries, continents, airlines, aircraft, routes, cabin, delays, cost, time of day, and more, each its own panel." />
            <Feature title="Cross-filtering" desc="Click almost anything (a bar, a slice, a row, an airport) to filter every chart and the map at once, and drill into any year." />
            <Feature title="Cost & points" desc="Cash and award spend tracked per booking and converted to any display currency at the historical rate on the day you flew." />
            <Feature title="Punctuality" desc="Departure and arrival delays, on-time rates, and your most and least delayed flights." />
            <Feature title="Hands-off email import" desc="AI reads your booking and check-in emails and adds flights automatically, no forwarding or data entry, then enriches each one with airline, aircraft, and route detail. You can still add or import flights by hand whenever you like." />
          </ul>
        </div>
      </div>
    </Modal>
  );
}
