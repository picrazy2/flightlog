import { useState } from "react";
import { Segmented } from "@/components/ui/Segmented";

export type ChartType = "bar" | "pie";

// Bar / Pie toggle shared by the entity panels.
export function useChartType() {
  const [chartType, setChartType] = useState<ChartType>("bar");
  const control = (
    <Segmented
      aria-label="Chart type"
      size="sm"
      value={chartType}
      onChange={setChartType}
      options={[
        { value: "bar", label: "Bar" },
        { value: "pie", label: "Pie" },
      ]}
    />
  );
  return { chartType, control };
}
