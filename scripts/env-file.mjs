/**
 * Returns `text` (the contents of an env file) with each KEY in `values` set to its new value:
 * an existing `KEY=...` line is replaced in place, a missing key is appended. Every other line,
 * and the file's line endings, are left as they are.
 */
export function upsertEnv(text, values) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const remaining = new Map(Object.entries(values));

  const updated = lines.map((line) => {
    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key === undefined || !remaining.has(key)) return line;
    const next = `${key}=${remaining.get(key)}`;
    remaining.delete(key);
    return next;
  });
  for (const [key, value] of remaining) updated.push(`${key}=${value}`);

  return updated.join(eol) + eol;
}
