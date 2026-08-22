const hongKongUtcOffsetMs = 8 * 60 * 60 * 1_000;
const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function formatUtcForHongKongDateTimeInput(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("utc-timestamp-invalid");
  return new Date(timestamp + hongKongUtcOffsetMs).toISOString().slice(0, 16);
}

export function parseHongKongDateTimeInput(value: string) {
  const match = localDateTimePattern.exec(value.trim());
  if (!match) throw new Error("hong-kong-local-time-invalid");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText ?? "0"].map(
    Number,
  );
  const [year, month, day, hour, minute, second] = parts;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const normalized = new Date(localAsUtc);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day ||
    normalized.getUTCHours() !== hour ||
    normalized.getUTCMinutes() !== minute ||
    normalized.getUTCSeconds() !== second
  ) {
    throw new Error("hong-kong-local-time-invalid");
  }
  return new Date(localAsUtc - hongKongUtcOffsetMs).toISOString();
}
