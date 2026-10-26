export type ClassroomRosterRow = { row: number; account: string; displayName: string; email?: string; status: "valid" | "duplicate" | "invalid" | "new" | "existing"; error?: string };
export type ClassroomInitialCredential = { account: string; displayName: string; initialPassword: string };

/** Bounded RFC4180-style CSV; reject unknown columns so imported roles cannot be trusted. */
export function parseClassroomRosterCsv(csv: string): ClassroomRosterRow[] {
  if (new TextEncoder().encode(csv).length > 100_000) throw new Error("CSV exceeds 100 KB.");
  const records: string[][] = [];
  let cells: string[] = [], cell = "", quoted = false, closed = false;
  const input = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ",") { cells.push(cell); cell = ""; closed = false; }
    else if (char === "\n" || char === "\r") {
      cells.push(cell); if (cells.some(value => value.trim())) records.push(cells);
      cells = []; cell = ""; closed = false;
      if (char === "\r" && input[i + 1] === "\n") i++;
    } else {
      if (closed || char === '"') throw new Error("Malformed CSV quotation.");
      cell += char;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quotation.");
  cells.push(cell); if (cells.some(value => value.trim())) records.push(cells);
  const header = records.shift()?.map(value => value.trim()) ?? [];
  if (!header.includes("account") || !header.includes("displayName") || header.some(name => !["account", "displayName", "email"].includes(name)) || new Set(header).size !== header.length) throw new Error("CSV columns must be account,displayName and optional email.");
  if (!records.length || records.length > 100) throw new Error("CSV must contain 1–100 students.");
  const accounts = new Set<string>(), emails = new Set<string>();
  return records.map((values, index) => {
    const account = (values[header.indexOf("account")] ?? "").trim().toLowerCase();
    const displayName = (values[header.indexOf("displayName")] ?? "").trim();
    const email = (values[header.indexOf("email")] ?? "").trim().toLowerCase();
    const row: ClassroomRosterRow = { row: index + 2, account, displayName, ...(email ? { email } : {}), status: "valid" };
    if (values.length !== header.length || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(account) || !displayName || displayName.length > 160 || /[\u0000-\u001f]/.test(displayName) || (email && (email.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)))) return { ...row, status: "invalid", error: "Invalid account, display name or email." };
    if (accounts.has(account) || (email && emails.has(email))) return { ...row, status: "duplicate", error: "Duplicate account or email in this file." };
    accounts.add(account); if (email) emails.add(email);
    return row;
  });
}

export function rosterCredentialsCsv(rows: ClassroomInitialCredential[]): string {
  const safe = (value: string) => `"${(/^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return "\uFEFFaccount,displayName,initialPassword\r\n" + rows.map(row => [row.account, row.displayName, row.initialPassword].map(safe).join(",")).join("\r\n");
}
