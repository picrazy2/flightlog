import { moduleById } from "@/stats/registry";
import { useStore } from "@/state/store";
import { Panel } from "@/components/ui/Panel";
import type { StatContext } from "@/stats/types";

// Renders the active module's panel. No branching — just look it up and render.
export function DetailPanelHost({ ctx }: { ctx: StatContext }) {
  const { activeModuleId, setActiveModule, crossFilters, clearCrossFilters } = useStore();
  const mod = moduleById(activeModuleId);
  if (!mod) return null;
  const model = mod.card(ctx);
  return (
    <div className="pointer-events-auto">
      <Panel
        title={model.headline ?? model.title ?? model.eyebrow}
        onClose={() => setActiveModule(null)}
        onReset={crossFilters.length > 0 ? clearCrossFilters : undefined}
      >
        <mod.Panel ctx={ctx} />
      </Panel>
    </div>
  );
}
