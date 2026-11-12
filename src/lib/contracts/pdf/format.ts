const currencyFormat = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "_______________";
  return currencyFormat.format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "_______________";
  return new Date(value).toLocaleDateString("en-ZA", { dateStyle: "medium" });
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "_______________";
  return `${value}%`;
}

export function formatKm(value: number | null | undefined): string {
  if (value == null) return "_______________";
  return `${value.toLocaleString("en-ZA")}km`;
}

export function blank(value: string | null | undefined): string {
  return value && value.trim() ? value : "_______________";
}
