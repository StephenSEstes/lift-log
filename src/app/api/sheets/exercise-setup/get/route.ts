import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

type SheetValue = string;
type SheetsValuesResponse = { values?: SheetValue[][] };
type SessionWithAccessToken = Session & { accessToken?: string };

const asString = (value?: string | number) => (value ?? "").toString().trim();
const asNumber = (value?: string | number) => Number(value ?? 0);
const normalizeHeader = (value?: string | number) =>
  asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const asOptionalBoolean = (value?: string | number) => {
  const normalized = asString(value).toLowerCase();
  if (!normalized) return undefined;
  if (["false", "no", "0"].includes(normalized)) return false;
  if (["true", "yes", "1"].includes(normalized)) return true;
  return undefined;
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken;
  const userEmail = session?.user?.email;

  if (!accessToken || !userEmail) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const exerciseKey = (searchParams.get("exerciseKey") ?? "").trim();

  if (!exerciseKey) {
    return Response.json({ error: "Missing exerciseKey" }, { status: 400 });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_EXERCISE_SETUP ?? "ExerciseSetup";

  if (!spreadsheetId) {
    return Response.json({ error: "Missing SPREADSHEET_ID" }, { status: 500 });
  }

  const valuesUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A:K`;

  const resp = await fetch(valuesUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await resp.json().catch(() => ({}))) as SheetsValuesResponse;
  if (!resp.ok) {
    return Response.json(
      { error: "Failed reading ExerciseSetup", status: resp.status, data },
      { status: resp.status }
    );
  }

  const rows: SheetValue[][] = data.values ?? [];
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
  let match: SheetValue[] | null = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowEmail = asString(row[idxUserEmail]);
    const rowExerciseKey = asString(row[idxExerciseKey]);
    const isDeleted =
      idxIsDeleted >= 0 && asString(row[idxIsDeleted]).toUpperCase() === "TRUE";
    if (!isDeleted && rowEmail === userEmail && rowExerciseKey === exerciseKey) {
      match = row;
      break;
    }
  }

  if (!match) {
    return Response.json({ found: false });
  }

  return Response.json({
    found: true,
    row: {
      setupId: asString(match[idxSetupId]),
      userEmail: asString(match[idxUserEmail]),
      exerciseKey: asString(match[idxExerciseKey]),
      defaultRestSeconds: asNumber(match[idxDefaultRestSeconds]),
      requiresWeight:
        idxRequiresWeight >= 0
          ? asOptionalBoolean(match[idxRequiresWeight])
          : undefined,
      notes: asString(match[idxNotes]),
      setupJson: asString(match[idxSetupJson]),
      createdAt: asString(match[idxCreatedAt]),
      updatedAt: asString(match[idxUpdatedAt]),
    },
  });
}
