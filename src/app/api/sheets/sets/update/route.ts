import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import type { UpdateSetRequest } from "@/lib/types/sheetsRequests";

function isoNow() {
  return new Date().toISOString();
}

type SheetValue = string;
type SheetsValuesResponse = { values?: SheetValue[][] };
type SessionWithAccessToken = Session & { accessToken?: string };

const asString = (value?: string | number) => (value ?? "").toString().trim();
const normalizeHeader = (value?: string | number) =>
  asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const toColumnLetter = (column: number) => {
  let result = "";
  let value = column;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || "A";
};

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken;

  if (!accessToken) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_WORKOUT_SETS || "WorkoutSets";

  if (!spreadsheetId) {
    return Response.json({ error: "Missing SPREADSHEET_ID" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as UpdateSetRequest | null;
  const {
    setId: rawSetId,
    setNumber: rawSetNumber,
    weight: rawWeight,
    reps: rawReps,
    rpe: rawRpe,
    notes: rawNotes,
    RestSeconds: rawRestSeconds,
    restSeconds: rawRestSecondsAlt,
    restSec: rawRestSec,
    restTargetSec: rawRestTargetSec,
  } = body ?? {};
  const setId = (rawSetId ?? "").toString().trim();

  if (!setId) {
    return Response.json({ error: "Missing setId" }, { status: 400 });
  }

  // 1) Read the whole SetId column to find the row index
  // Headers are row 1; data begins row 2.
  const idColUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A:A`;

  const idResp = await fetch(idColUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const idJson = (await idResp.json().catch(() => ({}))) as SheetsValuesResponse;
  if (!idResp.ok) {
    return Response.json(
      { error: "Failed reading SetId column", status: idResp.status, idJson },
      { status: idResp.status }
    );
  }

  const values: SheetValue[][] = idJson.values ?? [];
  // values[0] is header row if present
  let rowIndex1Based: number | null = null;

  for (let i = 1; i < values.length; i++) {
    const cell = (values[i]?.[0] ?? "").toString().trim();
    if (cell === setId) {
      rowIndex1Based = i + 1; // because i=1 corresponds to row 2
      break;
    }
  }

  if (!rowIndex1Based) {
    return Response.json({ error: "SetId not found", setId }, { status: 404 });
  }

  // 2) Read the header row to locate columns
  const headerUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!1:1`;

  const headerResp = await fetch(headerUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const headerJson = (await headerResp.json().catch(() => ({}))) as SheetsValuesResponse;
  if (!headerResp.ok) {
    return Response.json(
      { error: "Failed reading WorkoutSets headers", status: headerResp.status, headerJson },
      { status: headerResp.status }
    );
  }

  const headerRow = headerJson.values?.[0] ?? [];
  const headerMap = new Map<string, number>();
  headerRow.forEach((value, index) => {
    const key = normalizeHeader(value);
    if (!key) return;
    if (!headerMap.has(key)) headerMap.set(key, index);
  });

  const getIndex = (keys: string[], fallback?: number) => {
    for (const key of keys) {
      const idx = headerMap.get(key);
      if (idx != null) return idx;
    }
    return fallback ?? -1;
  };

  const idxSetNumber = getIndex(["setnumber", "set_number"], 5);
  const idxWeight = getIndex(["weight"], 6);
  const idxReps = getIndex(["reps"], 7);
  const idxRpe = getIndex(["rpe"], 8);
  const idxRestSec = getIndex(["restsec", "restseconds", "rest_seconds"], 9);
  const idxRestTargetSec = getIndex(["resttargetsec", "resttargetseconds", "rest_target_seconds"], 10);
  const idxNotes = getIndex(["notes"], 11);
  const idxUpdatedAt = getIndex(["updatedat"], 13);

  // 3) Read the full row so we can preserve fields you don't update
  const rowUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A${rowIndex1Based}:O${rowIndex1Based}`;

  const rowResp = await fetch(rowUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const rowJson = (await rowResp.json().catch(() => ({}))) as SheetsValuesResponse;
  if (!rowResp.ok) {
    return Response.json(
      { error: "Failed reading target row", status: rowResp.status, rowJson },
      { status: rowResp.status }
    );
  }

  const row = (rowJson.values?.[0] ?? []) as SheetValue[];

  const updatedRow = [...row];
  const setIfProvided = (idx: number, val: unknown) => {
    if (val !== undefined && val !== null) updatedRow[idx] = String(val);
  };

  const restSeconds = rawRestSeconds ?? rawRestSecondsAlt ?? rawRestSec;

  if (idxSetNumber >= 0) setIfProvided(idxSetNumber, rawSetNumber);
  if (idxWeight >= 0) setIfProvided(idxWeight, rawWeight);
  if (idxReps >= 0) setIfProvided(idxReps, rawReps);
  if (idxRpe >= 0) setIfProvided(idxRpe, rawRpe);
  if (idxRestSec >= 0) setIfProvided(idxRestSec, restSeconds);
  if (idxRestTargetSec >= 0) setIfProvided(idxRestTargetSec, rawRestTargetSec);
  if (idxNotes >= 0) setIfProvided(idxNotes, rawNotes);

  // UpdatedAt (N) always changes
  if (idxUpdatedAt >= 0) {
    updatedRow[idxUpdatedAt] = isoNow();
  }

  // Ensure row matches current header length (fallback to existing size)
  const totalColumns = Math.max(headerRow.length, updatedRow.length);
  while (updatedRow.length < totalColumns) updatedRow.push("");
  if (updatedRow.length > totalColumns) updatedRow.length = totalColumns;

  // 3) Write the updated row back
  const updateUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A${rowIndex1Based}:${
      toColumnLetter(totalColumns)
    }${rowIndex1Based}` +
    `?valueInputOption=USER_ENTERED`;

  const upResp = await fetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [updatedRow] }),
  });

  const upJson = (await upResp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upResp.ok) {
    return Response.json(
      { error: "Failed updating row", status: upResp.status, upJson },
      { status: upResp.status }
    );
  }

  return Response.json({ ok: true, setId, rowIndex1Based });
}
