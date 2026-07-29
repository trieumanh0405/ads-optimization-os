import { createSign } from "node:crypto";
import { z } from "zod";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const MAX_ROWS = 20_000;
const ROW_ANCHOR_HEADERS = new Set([
  "date", "day", "reporting starts", "reporting ends", "account id",
  "campaign id", "campaign name", "ad set id", "adset id", "ad set name", "adset name",
  "ad id", "ad name"
]);

const credentialsSchema = z.object({
  type: z.literal("service_account"),
  client_email: z.string().email(),
  private_key: z.string().min(1),
  token_uri: z.string().url().optional()
});

export type GoogleSheetPreview = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  headerRow: number;
  headers: string[];
  rows: Record<string, string>[];
  truncated: boolean;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SHEETS_NOT_CONFIGURED");
  try {
    return credentialsSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_INVALID");
  }
}

function createAssertion(credentials: z.infer<typeof credentialsSchema>) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: credentials.token_uri ?? GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3_300
  }));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const credentials = getCredentials();
  const response = await fetch(credentials.token_uri ?? GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createAssertion(credentials)
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error ? `GOOGLE_TOKEN_${payload.error}` : "GOOGLE_TOKEN_FAILED");
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3_000) * 1_000 };
  return cachedToken.value;
}

export function spreadsheetIdFromInput(input: string) {
  const trimmed = input.trim();
  const matched = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = matched?.[1] ?? (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : null);
  if (!id) throw new Error("GOOGLE_SHEETS_URL_INVALID");
  return id;
}

export function rowsFromGoogleValues(values: unknown[][], headerRow: number) {
  const headerIndex = headerRow - 1;
  const headerCells = values[headerIndex];
  if (!headerCells?.length) throw new Error("GOOGLE_SHEETS_HEADER_ROW_EMPTY");
  const headers = headerCells.map((value, index) => String(value ?? "").trim() || `Column ${index + 1}`);
  if (new Set(headers).size !== headers.length) throw new Error("GOOGLE_SHEETS_DUPLICATE_HEADERS");
  const normalizedHeaders = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const anchorIndexes = normalizedHeaders.flatMap((header, index) => ROW_ANCHOR_HEADERS.has(header) ? [index] : []);
  const nonEmptyLines = values.slice(headerIndex + 1)
    .filter((line) => line.some((value) => String(value ?? "").trim() !== ""));
  // Connector/Looker tabs often carry formulas below the real export range.
  // A formula returning 0 is not an ad row; require an identity/date anchor
  // whenever the source exposes standard Ads Manager headers.
  const dataLines = anchorIndexes.length
    ? nonEmptyLines.filter((line) => anchorIndexes.some((index) => String(line[index] ?? "").trim() !== ""))
    : nonEmptyLines;
  const rows = dataLines
    .slice(0, MAX_ROWS)
    .map((line) => Object.fromEntries(headers.map((header, index) => [header, String(line[index] ?? "")]))) as Record<string, string>[];
  return { headers, rows, truncated: dataLines.length > MAX_ROWS };
}

export async function previewGoogleSheet(input: { spreadsheetInput: string; sheetName?: string; headerRow?: number }): Promise<GoogleSheetPreview> {
  const spreadsheetId = spreadsheetIdFromInput(input.spreadsheetInput);
  const token = await accessToken();
  const metadataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties(title),sheets(properties(title,hidden))`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000)
  });
  const metadata = await metadataResponse.json().catch(() => ({})) as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string; hidden?: boolean } }> };
  if (!metadataResponse.ok) throw new Error("GOOGLE_SHEETS_ACCESS_DENIED_OR_NOT_FOUND");
  const available = (metadata.sheets ?? []).map((sheet) => sheet.properties).filter((sheet): sheet is { title: string; hidden?: boolean } => Boolean(sheet?.title && !sheet.hidden));
  const sheetName = input.sheetName?.trim() || available[0]?.title;
  if (!sheetName || !available.some((sheet) => sheet.title === sheetName)) throw new Error("GOOGLE_SHEETS_TAB_NOT_FOUND");
  const headerRow = input.headerRow ?? 1;
  const range = `'${sheetName.replaceAll("'", "''")}'!A1:ZZ${MAX_ROWS + headerRow}`;
  const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000)
  });
  const valuesPayload = await valuesResponse.json().catch(() => ({})) as { values?: unknown[][] };
  if (!valuesResponse.ok) throw new Error("GOOGLE_SHEETS_READ_FAILED");
  const parsed = rowsFromGoogleValues(valuesPayload.values ?? [], headerRow);
  if (!parsed.rows.length) throw new Error("GOOGLE_SHEETS_NO_DATA_ROWS");
  return {
    spreadsheetId,
    spreadsheetTitle: metadata.properties?.title ?? spreadsheetId,
    sheetName,
    headerRow,
    ...parsed
  };
}
