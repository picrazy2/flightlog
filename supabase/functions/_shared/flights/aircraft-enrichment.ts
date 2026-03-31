import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { HttpError } from "./http.ts";
import { ensureAircraftTypeExists } from "./references.ts";
import { fetchAircraftRecordByRegistration } from "../reference/aircraft.ts";
import type { AircraftRow } from "./types.ts";

export async function maybeEnrichAircraft(
  supabase: SupabaseClient,
  registration: string | null,
  requestedAircraftTypeCode: string | null,
  warnings: string[],
) {
  if (!registration) {
    return { aircraft_type_code: requestedAircraftTypeCode };
  }

  const { data: existingAircraft, error: existingError } = await supabase
    .from("aircraft")
    .select("registration, aircraft_type_code")
    .eq("registration", registration)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(
      500,
      `Failed to check aircraft cache: ${existingError.message}`,
    );
  }

  if (existingAircraft) {
    return {
      aircraft_type_code: requestedAircraftTypeCode ??
        (existingAircraft.aircraft_type_code as string | null),
    };
  }

  try {
    const aircraftRecord = await fetchAircraftRecordByRegistration(
      registration,
    ) as AircraftRow | null;
    if (!aircraftRecord) {
      warnings.push(
        `Aircraft registration ${registration} was not found in AeroDataBox`,
      );
      return { aircraft_type_code: requestedAircraftTypeCode };
    }

    let aircraftTypeCode = requestedAircraftTypeCode ??
      aircraftRecord.aircraft_type_code;
    if (aircraftTypeCode) {
      try {
        await ensureAircraftTypeExists(supabase, aircraftTypeCode);
      } catch {
        warnings.push(
          `Aircraft type ${aircraftTypeCode} could not be resolved during aircraft enrichment`,
        );
        if (!requestedAircraftTypeCode) {
          aircraftTypeCode = null;
        }
      }
    }

    const { error: upsertError } = await supabase
      .from("aircraft")
      .upsert(
        {
          ...aircraftRecord,
          aircraft_type_code: aircraftTypeCode,
        },
        { onConflict: "registration" },
      );

    if (upsertError) {
      warnings.push(
        `Aircraft enrichment for ${registration} could not be cached: ${upsertError.message}`,
      );
      return { aircraft_type_code: requestedAircraftTypeCode };
    }

    return {
      aircraft_type_code: requestedAircraftTypeCode ?? aircraftTypeCode,
    };
  } catch (error) {
    warnings.push(
      `Aircraft enrichment for ${registration} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { aircraft_type_code: requestedAircraftTypeCode };
  }
}
