export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function cdPrefix(cwd: string): string {
  return cwd ? `cd ${shellQuote(cwd)} && ` : "";
}
