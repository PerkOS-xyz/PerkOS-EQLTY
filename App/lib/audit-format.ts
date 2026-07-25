export function shortHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function tokenAmount(
  raw: string,
  decimals: number,
  maximumFractionDigits = 6,
): string {
  const padded = raw.padStart(decimals + 1, "0");
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction =
    decimals === 0
      ? ""
      : padded
          .slice(-decimals)
          .replace(/0+$/, "")
          .slice(0, maximumFractionDigits);
  return fraction ? `${whole}.${fraction}` : whole;
}

export function shares(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(parsed);
}

export function signedMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(Math.abs(value));
  return value < 0 ? `−${formatted}` : value > 0 ? `+${formatted}` : formatted;
}

export function percent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

export function dateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
