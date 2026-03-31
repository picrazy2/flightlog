type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] };

type TableName =
  | "airports"
  | "airlines"
  | "aircraft_types"
  | "aircraft"
  | "bookings"
  | "flights"
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
      tracks: clone(seed.tracks ?? []),
      v_flights_with_airports: clone(seed.v_flights_with_airports ?? []),
    };

    this.syncFlightView();
  }

  from(table: string) {
    return new MockQueryBuilder(this, table as TableName);
  }

  syncFlightView() {
    this.db.v_flights_with_airports = this.db.flights.map((row) => ({ ...row }));
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

  constructor(
    private readonly client: MockSupabaseClient,
    private readonly table: TableName,
  ) {}

  select(_columns = "*") {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ kind: "in", column, values });
    return this.execute();
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
    const conflictColumn = this.onConflict ?? "id";
    const matchValue = row[conflictColumn];
    const existing = this.client.db[this.table].find((candidate) =>
      candidate[conflictColumn] === matchValue
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
    return this.client.db[this.table].filter((row) =>
      matchesFilters(row, this.filters)
    );
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

    return filter.values.includes(row[filter.column]);
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function needsId(table: TableName): table is "bookings" | "flights" | "tracks" {
  return table === "bookings" || table === "flights" || table === "tracks";
}
