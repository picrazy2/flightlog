import { createClient } from "npm:@supabase/supabase-js@2";

import { refreshAirportBoundary } from "../functions/_shared/reference/airport-boundaries.ts";

type AirportRow = {
  iata: string;
};

type Config = {
  batchSize: number;
  limit: number | null;
  delayMs: number;
  jitterMs: number;
  maxRetries: number;
  retryDelaysMs: number[];
  startAfter: string | null;
  logFile: string;
};

const DEFAULT_CONFIG: Config = {
  batchSize: 100,
  limit: null,
  delayMs: 3_000,
  jitterMs: 1_000,
  maxRetries: 3,
  retryDelaysMs: [10_000, 30_000, 60_000],
  startAfter: null,
  logFile: "supabase/scripts/logs/backfill-airport-boundaries.log.jsonl",
};

const config = parseArgs(Deno.args);
const supabase = createAdminClient();
await ensureLogDirectory(config.logFile);

let processed = 0;
let succeeded = 0;
let failed = 0;
let cursor = config.startAfter;

await logEvent({
  event: "run_started",
  config: {
    batch_size: config.batchSize,
    limit: config.limit,
    delay_ms: config.delayMs,
    jitter_ms: config.jitterMs,
    max_retries: config.maxRetries,
    retry_delays_ms: config.retryDelaysMs,
    start_after: config.startAfter,
    log_file: config.logFile,
  },
});

for await (const airport of iterateAirportsWithoutBoundary(supabase, config.batchSize, cursor)) {
  if (config.limit !== null && processed >= config.limit) {
    break;
  }

  processed += 1;
  cursor = airport.iata;
  const outcome = await processAirport(airport.iata);
  if (outcome) {
    succeeded += 1;
  } else {
    failed += 1;
  }

  await sleepWithJitter(config.delayMs, config.jitterMs);
}

await logEvent({
  event: "run_completed",
  ok: true,
  processed,
  succeeded,
  failed,
  last_iata: cursor,
});

console.log(JSON.stringify({
  ok: true,
  processed,
  succeeded,
  failed,
  last_iata: cursor,
  log_file: config.logFile,
}, null, 2));

async function processAirport(iata: string): Promise<boolean> {
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const result = await refreshAirportBoundary(supabase, iata);
      await logEvent({
        event: "airport_processed",
        iata,
        ok: true,
        boundary_found: result.boundary_found,
        attempt: attempt + 1,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const willRetry = attempt < config.maxRetries;
      await logEvent({
        event: "airport_failed_attempt",
        iata,
        ok: false,
        attempt: attempt + 1,
        error: message,
        will_retry: willRetry,
      });

      if (!willRetry) {
        return false;
      }

      const retryDelay = config.retryDelaysMs[Math.min(attempt, config.retryDelaysMs.length - 1)];
      await sleepWithJitter(retryDelay, config.jitterMs);
    }
  }

  return false;
}

async function* iterateAirportsWithoutBoundary(
  client: ReturnType<typeof createAdminClient>,
  batchSize: number,
  startAfter: string | null,
): AsyncGenerator<AirportRow> {
  let cursor = startAfter;

  while (true) {
    let query = client
      .from("airports")
      .select("iata")
      .is("boundary_geojson", null)
      .order("iata", { ascending: true })
      .limit(batchSize);

    if (cursor) {
      query = query.gt("iata", cursor);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load airports without boundaries: ${error.message}`);
    }

    const rows = (data ?? []) as AirportRow[];
    if (rows.length === 0) {
      return;
    }

    for (const row of rows) {
      yield row;
    }

    cursor = rows.at(-1)?.iata ?? null;
  }
}

function createAdminClient() {
  const url = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseArgs(args: string[]): Config {
  const config = { ...DEFAULT_CONFIG };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--batch-size":
        config.batchSize = parsePositiveInt(next, "--batch-size");
        index += 1;
        break;
      case "--limit":
        config.limit = parsePositiveInt(next, "--limit");
        index += 1;
        break;
      case "--delay-ms":
        config.delayMs = parsePositiveInt(next, "--delay-ms");
        index += 1;
        break;
      case "--jitter-ms":
        config.jitterMs = parsePositiveInt(next, "--jitter-ms");
        index += 1;
        break;
      case "--max-retries":
        config.maxRetries = parseNonNegativeInt(next, "--max-retries");
        index += 1;
        break;
      case "--start-after":
        config.startAfter = next?.trim().toUpperCase() || null;
        index += 1;
        break;
      case "--log-file":
        if (!next?.trim()) {
          throw new Error("--log-file expects a path");
        }
        config.logFile = next.trim();
        index += 1;
        break;
      case "--help":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} expects a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} expects a non-negative integer`);
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  deno run --allow-net --allow-read --allow-write --allow-env supabase/scripts/backfill-airport-boundaries.ts [options]

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Options:
  --batch-size <n>     DB page size while scanning airports without boundaries (default: 100)
  --limit <n>          Stop after processing n airports
  --delay-ms <n>       Base delay between successful requests (default: 3000)
  --jitter-ms <n>      Random jitter added to delays (default: 1000)
  --max-retries <n>    Retries per airport after failure (default: 3)
  --start-after <IATA> Resume after a specific airport code
  --log-file <path>    Append JSONL logs to this file
  --help               Show this message
`);
  Deno.exit(0);
}

async function sleepWithJitter(baseMs: number, jitterMs: number) {
  const extra = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  await new Promise((resolve) => setTimeout(resolve, baseMs + extra));
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function ensureLogDirectory(logFile: string) {
  const directory = dirname(logFile);
  if (!directory || directory === ".") {
    return;
  }

  await Deno.mkdir(directory, { recursive: true });
}

async function logEvent(payload: Record<string, unknown>) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  }) + "\n";

  await Deno.writeTextFile(config.logFile, line, { append: true, create: true });
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }
  if (lastSlash === 0) {
    return "/";
  }
  return normalized.slice(0, lastSlash);
}
