import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import type { UpsertExerciseSetupRequest } from "@/lib/types/sheetsRequests";

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type SheetValue = string;

const asString = (value?: string | number) => (value ?? "").toString().trim();
const normalizeHeader = (value?: string | number) =>
  asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
type SheetsValuesResponse = { values?: SheetValue[][] };
type SessionWithAccessToken = Session & { accessToken?: string };

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
  const userEmail = session?.user?.email;

  if (!accessToken || !userEmail) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_EXERCISE_SETUP ?? "ExerciseSetup";

  if (!spreadsheetId) {
    return Response.json({ error: "Missing SPREADSHEET_ID" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as UpsertExerciseSetupRequest | null;
  const {
    exerciseKey: rawExerciseKey,
    defaultRestSeconds: rawDefaultRestSeconds,
    notes: rawNotes,
    setupJson: rawSetupJson,
    requiresWeight: rawRequiresWeight,
  } = body ?? {};
  const exerciseKey = (rawExerciseKey ?? "").toString().trim();
  const defaultRestSeconds = rawDefaultRestSeconds ?? "";
  const notes = rawNotes ?? "";
  const setupJson = rawSetupJson ?? "";
  const requiresWeight =
    typeof rawRequiresWeight === "boolean"
      ? rawRequiresWeight
      : rawRequiresWeight?.toString().toLowerCase() !== "false";

  if (!exerciseKey) {
    return Response.json({ error: "Missing exerciseKey" }, { status: 400 });
  }

  const valuesUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A:I`;

  const readResp = await fetch(valuesUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const readJson = (await readResp.json().catch(() => ({}))) as SheetsValuesResponse;
  if (!readResp.ok) {
    return Response.json(
      { error: "Failed reading ExerciseSetup", status: readResp.status, readJson },
      { status: readResp.status }
    );
  }

  const rows: SheetValue[][] = readJson.values ?? [];
  const headerRow = rows[0] ?? [];
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

  const idxSetupId = getIndex(["setupid"], 0);
  const idxUserEmail = getIndex(["useremail"], 1);
  const idxExerciseKey = getIndex(["exercisekey", "exerciseid", "exercise_id"], 2);
  const idxDefaultRestSeconds = getIndex(["defaultrestseconds", "defaultrest"], 3);
  const idxNotes = getIndex(["notes"], 4);
  const idxSetupJson = getIndex(["setupjson"], 5);
  const idxRequiresWeight = getIndex(["requiresweight"]);
  const idxCreatedAt = getIndex(["createdat"], 6);
  const idxUpdatedAt = getIndex(["updatedat"], 7);
  const idxIsDeleted = getIndex(["isdeleted"], 8);
  const totalColumns = Math.max(headerRow.length, idxIsDeleted + 1, idxUpdatedAt + 1);
  let rowIndex1Based: number | null = null;
  let row: SheetValue[] = [];

  for (let i = 1; i < rows.length; i++) {
    const candidate = rows[i] ?? [];
    const rowEmail = asString(candidate[idxUserEmail]);
    const rowExerciseKey = asString(candidate[idxExerciseKey]);
    if (rowEmail === userEmail && rowExerciseKey === exerciseKey) {
      rowIndex1Based = i + 1;
      row = candidate;
      break;
    }
  }

  const updatedAt = isoNow();

  if (rowIndex1Based) {
    const updatedRow = [...row];
    updatedRow[idxUserEmail] = userEmail;
    updatedRow[idxExerciseKey] = exerciseKey;
    updatedRow[idxDefaultRestSeconds] = String(defaultRestSeconds);
    updatedRow[idxNotes] = String(notes);
    updatedRow[idxSetupJson] = String(setupJson);
    if (idxRequiresWeight >= 0) {
      updatedRow[idxRequiresWeight] = requiresWeight ? "TRUE" : "FALSE";
    }
    updatedRow[idxUpdatedAt] = updatedAt;

    while (updatedRow.length < totalColumns) updatedRow.push("");
    if (updatedRow.length > totalColumns) updatedRow.length = totalColumns;

    const updateUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values/${encodeURIComponent(sheetName)}!A${rowIndex1Based}:${
        toColumnLetter(totalColumns)
      }${rowIndex1Based}` +
      `?valueInputOption=USER_ENTERED`;

    const updateResp = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [updatedRow] }),
    });

    const updateJson = (await updateResp.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!updateResp.ok) {
      return Response.json(
        { error: "Failed updating ExerciseSetup", status: updateResp.status, updateJson },
        { status: updateResp.status }
      );
    }

    return Response.json({ ok: true, updated: true });
  }

  const createdAt = updatedAt;
  const setupId = makeId("setup");

  const newRow = Array.from({ length: totalColumns }, () => "");
  newRow[idxSetupId] = setupId;
  newRow[idxUserEmail] = userEmail;
  newRow[idxExerciseKey] = exerciseKey;
  newRow[idxDefaultRestSeconds] = String(defaultRestSeconds);
  newRow[idxNotes] = String(notes);
  newRow[idxSetupJson] = String(setupJson);
  if (idxRequiresWeight >= 0) {
    newRow[idxRequiresWeight] = requiresWeight ? "TRUE" : "FALSE";
  }
  newRow[idxCreatedAt] = createdAt;
  newRow[idxUpdatedAt] = updatedAt;
  if (idxIsDeleted >= 0) {
    newRow[idxIsDeleted] = "FALSE";
  }

  const appendUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A1:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const appendResp = await fetch(appendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [newRow] }),
  });

  const appendJson = (await appendResp.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!appendResp.ok) {
    return Response.json(
      { error: "Failed appending ExerciseSetup", status: appendResp.status, appendJson },
      { status: appendResp.status }
    );
  }

  return Response.json({ ok: true, created: true, setupId });
}
