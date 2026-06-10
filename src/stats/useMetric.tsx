import { useState } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { flightDistanceMi, flightMinutes } from "@/lib/format";
import type { Flight } from "@/lib/types";

export type Metric = "flights" | "distance" | "time";

export const metricValue = (f: Flight, m: Metric): number =>
  m === "flights" ? 1 : m === "distance" ? flightDistanceMi(f) : flightMinutes(f);

export const metricName: Record<Metric, string> = {
  flights: "flights",
  distance: "mi",
  time: "min",
};

// Standard flights / distance / time selector (dropdown) used across panels.
export function useMetricToggle(size: "sm" | "md" = "sm") {
  const [metric, setMetric] = useState<Metric>("flights");
  const control = (
    <Segmented
      aria-label="Metric"
      size={size}
      value={metric}
      onChange={setMetric}
      options={[
        { value: "flights", label: "Flights" },
        { value: "distance", label: "Dist" },
        { value: "time", label: "Time" },
      ]}
    />
  );
  return { metric, control };
}
