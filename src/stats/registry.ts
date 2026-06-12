import type { StatModule } from "./types";
import { overall } from "./modules/overall";
import { airports } from "./modules/airports";
import { airlines, cities, aircraft } from "./modules/simple";
import { countries } from "./modules/countries";
import { continents } from "./modules/continents";
import { routes } from "./modules/routes";
import { domesticIntl } from "./modules/domesticIntl";
import { delays } from "./modules/delays";
import { cabinClass } from "./modules/cabinClass";
import { timeOfDay } from "./modules/timeOfDay";
import { cost } from "./modules/cost";

// The ONLY list of stats. Display order = `order`. Add a stat = add it here.
export const REGISTRY: StatModule[] = [
  overall,
  airports,
  airlines,
  cities,
  countries,
  continents,
  routes,
  domesticIntl,
  delays,
  cabinClass,
  timeOfDay,
  aircraft,
  cost,
].sort((a, b) => a.order - b.order);

export const moduleById = (id: string | null): StatModule | undefined =>
  id ? REGISTRY.find((m) => m.id === id) : undefined;

// Default map encoding when no module is active (domestic/intl routes + visit-sized airports).
export { domesticIntl as defaultEncodingModule };
