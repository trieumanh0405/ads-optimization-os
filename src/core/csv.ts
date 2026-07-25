export function parseCsv(text: string): Record<string, string>[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = ([",", ";", "\t"] as const)
    .map((value) => ({ value, count: firstLine.split(value).length - 1 }))
    .sort((a, b) => b.count - a.count)[0].value;
  const matrix: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]; const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); matrix.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  if (field.length || row.length) { row.push(field); matrix.push(row); }
  const nonEmpty = matrix.filter((item) => item.some((value) => value.trim() !== ""));
  if (nonEmpty.length < 2) throw new Error("CSV_REQUIRES_HEADER_AND_DATA");
  const headers = nonEmpty[0].map((value) => value.trim().replace(/^\uFEFF/, ""));
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) throw new Error("CSV_HEADERS_INVALID_OR_DUPLICATE");
  return nonEmpty.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}
