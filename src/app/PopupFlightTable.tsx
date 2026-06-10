export interface PopupRow {
  id: string;
  date: string;
  code: string;
  route: string;
}

// Compact flight list used in click popups when there are ≤5 flights.
export function PopupFlightTable({ rows }: { rows: PopupRow[] }) {
  return (
    <div style={{ maxHeight: 200, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "3px 6px 3px 0", color: "var(--ink-muted)", whiteSpace: "nowrap" }}>{r.date}</td>
              <td style={{ padding: "3px 6px", fontFamily: "Geist Mono, monospace" }}>{r.code}</td>
              <td style={{ padding: "3px 0", whiteSpace: "nowrap" }}>{r.route}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
