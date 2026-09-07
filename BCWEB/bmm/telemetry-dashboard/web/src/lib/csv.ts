// Client-side CSV export — turns any row set already loaded in the dashboard into a
// downloadable file. No backend round-trip; what you see is what you export.
type Col<T> = { key: string; label?: string; get?: (row: T) => unknown };

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Quote when the value could break a CSV cell; double any embedded quotes (RFC 4180).
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], cols: Col<T>[]): string {
  const head = cols.map((c) => cell(c.label ?? c.key)).join(",");
  const body = rows.map((r) => cols.map((c) => cell(c.get ? c.get(r) : (r as any)[c.key])).join(",")).join("\r\n");
  return `${head}\r\n${body}`;
}

export function downloadCsv<T>(filename: string, rows: T[], cols: Col<T>[]): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob(["\ufeff" + toCsv(rows, cols)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
