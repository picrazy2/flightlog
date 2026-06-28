type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "neq"; column: string; value: unknown }
  | { kind: "is"; column: string; value: null }
  | { kind: "notnull"; column: string }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "contains"; column: string; value: unknown };

type TableName =
  | "airports"
  | "airlines"
  | "aircraft_types"
  | "aircraft"
  | "bookings"
  | "flights"
  | "sync_state"
  | "tracks"
  | "v_flights_with_airports";

type DatabaseState = Record<TableName, Record<string, unknown>[]>;

export function assert(condition: unknown, message = "Assertion failed") {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ??
        `Expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  expectedMessage: string,
) {
  try {
    await fn();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(expectedMessage)
    ) {
      return;
    }

    throw new Error(
      `Expected rejection including "${expectedMessage}", received ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  throw new Error(`Expected rejection including "${expectedMessage}"`);
}

export function createMockSupabaseClient(
  seed: Partial<DatabaseState> = {},
) {
  return new MockSupabaseClient(seed);
}

class MockSupabaseClient {
  db: DatabaseState;
  ids = {
    bookings: 1,
    flights: 1,
    tracks: 1,
  };

  constructor(seed: Partial<DatabaseState>) {
    this.db = {
      airports: clone(seed.airports ?? []),
      airlines: clone(seed.airlines ?? []),
      aircraft_types: clone(seed.aircraft_types ?? []),
      aircraft: clone(seed.aircraft ?? []),
      bookings: clone(seed.bookings ?? []),
      flights: clone(seed.flights ?? []),
      sync_state: clone(seed.sync_state ?? []),
      tracks: clone(seed.tracks ?? []),
      v_flights_with_airports: clone(seed.v_flights_with_airports ?? []),
    };

    this.syncFlightView();
  }

  from(table: string) {
    return new MockQueryBuilder(this, table as TableName);
  }

  syncFlightView() {
    this.db.v_flights_with_airports = this.db.flights.map((row) => {
      const track = this.db.tracks.find((candidate) => candidate.flight_id === row.id);
      return {
        ...row,
        has_track: Boolean(track),
        track_source: (track?.source as string | null) ?? null,
        track_recorded_at: (track?.recorded_at as string | null) ?? null,
      };
    });
  }

  nextId(table: "bookings" | "flights" | "tracks") {
    const current = this.ids[table];
    this.ids[table] += 1;
    return `00000000-0000-4000-8000-${String(current).padStart(12, "0")}`;
  }
}

class MockQueryBuilder implements PromiseLike<{ data: unknown; error: unknown }> {
  private operation: "select" | "insert" | "update" | "delete" | "upsert" =
    "select";
  private filters: Filter[] = [];
  private payload: Record<string, unknown> | Record<string, unknown>[] | null =
    null;
  private onConflict: string | null = null;
  private nullEqError: string | null = null;
  private limitN: number | null = null;

  constructor(
    private readonly client: MockSupabaseClient,
    private readonly table: TableName,
  ) {}

  select(_columns = "*") {
    return this;
  }

  eq(column: string, value: unknown) {
    // Mirror PostgREST: .eq(col, null) sends `col=eq.null`, which Postgres rejects
    // for typed columns (e.g. uuid). Real null filtering must use .is().
    if (value === null) {
      this.nullEqError = column;
    }
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  is(column: string, value: null) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  // Only the `.not(col, "is", null)` form (column IS NOT NULL) is used / supported.
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) {
      throw new Error(`Mock .not only supports ("col", "is", null); got ("${operator}", ${String(value)})`);
    }
    this.filters.push({ kind: "notnull", column });
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  // jsonb array containment: column @> value (e.g. booking_refs_airline @> [{pnr}])
  contains(column: string, value: unknown) {
    this.filters.push({ kind: "contains", column, value });
    return this;
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  upsert(
    payload: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string },
  ) {
    this.operation = "upsert";
    this.payload = payload;
    this.onConflict = options?.onConflict ?? null;
    return this;
  }

  maybeSingle() {
    return this.executeSingle(true);
  }

  single() {
    return this.executeSingle(false);
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    if (this.nullEqError) {
      return {
        data: null,
        error: {
          message: `invalid input syntax for type uuid: "null"`,
          column: this.nullEqError,
        },
      };
    }

    switch (this.operation) {
      case "select":
        return { data: this.filteredRows(), error: null };
      case "insert":
        return this.executeInsert();
      case "update":
        return this.executeUpdate();
      case "delete":
        return this.executeDelete();
      case "upsert":
        return this.executeUpsert();
    }
  }

  private async executeSingle(allowNull: boolean) {
    const result = await this.execute();
    if (result.error) {
      return result;
    }

    const rows = Array.isArray(result.data) ? result.data : [result.data];
    if (rows.length === 0) {
      return allowNull
        ? { data: null, error: null }
        : { data: null, error: { message: "Expected 1 row, received 0" } };
    }

    if (rows.length > 1) {
      return { data: null, error: { message: "Expected 1 row, received many" } };
    }

    return { data: rows[0], error: null };
  }

  private executeInsert() {
    const rows = normalizePayload(this.payload);
    const inserted = rows.map((row) => this.insertRow(row));
    return { data: inserted, error: null };
  }

  private executeUpdate() {
    const rows = this.filteredRows();
    for (const row of rows) {
      Object.assign(row, this.payload ?? {});
    }

    if (this.table === "flights") {
      this.client.syncFlightView();
    }

    return { data: null, error: null };
  }

  private executeDelete() {
    const kept: Record<string, unknown>[] = [];
    const removed: Record<string, unknown>[] = [];

    for (const row of this.client.db[this.table]) {
      if (matchesFilters(row, this.filters)) {
        removed.push(row);
      } else {
        kept.push(row);
      }
    }

    this.client.db[this.table] = kept;

    if (this.table === "flights") {
      const deletedIds = new Set(removed.map((row) => row.id));
      this.client.db.tracks = this.client.db.tracks.filter((track) =>
        !deletedIds.has(track.flight_id)
      );
      this.client.syncFlightView();
    }

    return { data: null, error: null };
  }

  private executeUpsert() {
    const rows = normalizePayload(this.payload);
    const upserted = rows.map((row) => this.upsertRow(row));
    return { data: upserted, error: null };
  }

  private insertRow(row: Record<string, unknown>) {
    const inserted = { ...row };
    if (!inserted.id && needsId(this.table)) {
      inserted.id = this.client.nextId(this.table);
    }

    this.client.db[this.table].push(inserted);
    if (this.table === "flights") {
      this.client.syncFlightView();
    }

    return inserted;
  }

  private upsertRow(row: Record<string, unknown>) {
    // Supports composite conflict targets, e.g. "flight_id,source".
    const conflictColumns = (this.onConflict ?? "id").split(",").map((c) => c.trim());
    const existing = this.client.db[this.table].find((candidate) =>
      conflictColumns.every((col) => candidate[col] === row[col])
    );

    if (existing) {
      Object.assign(existing, row);
      if (this.table === "flights") {
        this.client.syncFlightView();
      }
      return existing;
    }

    return this.insertRow(row);
  }

  private filteredRows() {
    const rows = this.client.db[this.table].filter((row) =>
      matchesFilters(row, this.filters)
    );
    return this.limitN != null ? rows.slice(0, this.limitN) : rows;
  }
}

function normalizePayload(
  payload: Record<string, unknown> | Record<string, unknown>[] | null,
) {
  if (!payload) {
    return [];
  }

  return Array.isArray(payload) ? payload.map((row) => ({ ...row })) : [{
    ...payload,
  }];
}

function matchesFilters(row: Record<string, unknown>, filters: Filter[]) {
  return filters.every((filter) => {
    if (filter.kind === "eq") {
      return row[filter.column] === filter.value;
    }

    if (filter.kind === "neq") {
      return row[filter.column] !== filter.value;
    }

    if (filter.kind === "is") {
      return (row[filter.column] ?? null) === filter.value;
    }

    if (filter.kind === "notnull") {
      return (row[filter.column] ?? null) !== null;
    }

    if (filter.kind === "contains") {
      // jsonb array @> [partialObj]: every query element must be contained in
      // some row element (subset match on object keys).
      const rowArr = (row[filter.column] ?? []) as Array<Record<string, unknown>>;
      const want = filter.value as Array<Record<string, unknown>>;
      return want.every((w) =>
        rowArr.some((r) =>
          Object.entries(w).every(([k, v]) => r?.[k] === v)
        )
      );
    }

    return filter.values.includes(row[filter.column]);
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function needsId(table: TableName): table is "bookings" | "flights" | "tracks" {
  return table === "bookings" || table === "flights" || table === "tracks";
}
