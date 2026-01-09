import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

type SheetValue = string;
type SheetsValuesResponse = { values?: SheetValue[][] };
type SessionWithAccessToken = Session & { accessToken?: string };

const asString = (value?: string | number) => (value ?? "").toString().trim();
const asNumber = (value?: string | number) => Number(value ?? 0);
const normalizeHeader = (value?: string | number) =>
  asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const asOptionalNumber = (value?: string | number) => {
  const raw = asString(value);
  if (!raw) return undefined;
  const num = asNumber(raw);
  return Number.isFinite(num) ? num : undefined;
};
const asOptionalBoolean = (value?: string | number) => {
  const raw = asString(value).toLowerCase();
  if (!raw) return undefined;
  if (["false", "no", "0"].includes(raw)) return false;
  if (["true", "yes", "1"].includes(raw)) return true;
  return undefined;
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken;

  if (!accessToken) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const exerciseKey = (searchParams.get("exerciseKey") ?? "").trim();

  if (!exerciseKey) {
    return Response.json({ found: false });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_EXERCISE_CATALOG ?? "ExerciseCatalog";

  if (!spreadsheetId) {
    return Response.json({ found: false });
  }

  const valuesUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A:Z`;

  const resp = await fetch(valuesUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    return Response.json({ found: false });
  }

  const data = (await resp.json().catch(() => ({}))) as SheetsValuesResponse;
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

  const idxExerciseKey = getIndex(["exercisekey", "exerciseid", "exercise_id"], 0);
  const idxExerciseName = getIndex(["exercisename", "exercise_name"], 1);
  const idxVideoUrl = getIndex(["videourl", "video_url", "youtubeurl"], 2);
  const idxDefaultRequiresWeight = getIndex(["defaultrequiresweight", "requiresweight"]);
  const idxDefaultRestSeconds = getIndex(["defaultrestseconds", "defaultrest"], 4);
  const idxIsActive = getIndex(["isactive"], 5);

  let match: SheetValue[] | null = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowKey = asString(row[idxExerciseKey]);
    if (rowKey === exerciseKey) {
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
      exerciseKey: asString(match[idxExerciseKey]),
      exerciseName: asString(match[idxExerciseName]),
      videoUrl: asString(match[idxVideoUrl]),
      defaultRequiresWeight: asOptionalBoolean(match[idxDefaultRequiresWeight]),
      defaultRestSeconds: asOptionalNumber(match[idxDefaultRestSeconds]),
      isActive: asOptionalBoolean(match[idxIsActive]),
    },
  });
}
