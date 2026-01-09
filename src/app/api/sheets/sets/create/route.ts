import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import type { CreateSetRequest } from "@/lib/types/sheetsRequests";

type SessionWithAccessToken = Session & { accessToken?: string };

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const asString = (value?: string | number) => (value ?? "").toString().trim();
const normalizeHeader = (value?: string | number) =>
  asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken;
  const userEmail = session?.user?.email;

  if (!accessToken || !userEmail) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_WORKOUT_SETS || "WorkoutSets";

  if (!spreadsheetId) {
    return Response.json({ error: "Missing SPREADSHEET_ID" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as CreateSetRequest | null;
  const {
    sessionId: rawSessionId,
    exerciseKey: rawExerciseKey,
    exerciseName: rawExerciseName,
    exerciseOrder: rawExerciseOrder,
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

  const sessionId = (rawSessionId ?? "").toString().trim();
  const exerciseKey = (rawExerciseKey ?? "").toString().trim();
  const exerciseName = (rawExerciseName ?? "").toString().trim();

  if (!sessionId || !exerciseKey || !exerciseName) {
    return Response.json(
      { error: "Missing required fields: sessionId, exerciseKey, exerciseName" },
      { status: 400 }
    );
  }

  const setNumber = Number(rawSetNumber ?? 1);
  const weightValue = rawWeight ?? "";
  const repsValue = rawReps ?? "";
  const rpeCandidate =
    rawRpe === "" || rawRpe === null || rawRpe === undefined ? undefined : rawRpe;
  const rpeNormalized = Number(rpeCandidate ?? 7);
  const rpeValue = Number.isFinite(rpeNormalized) ? rpeNormalized : 7;
  const restSeconds = rawRestSeconds ?? rawRestSecondsAlt ?? rawRestSec ?? "";
  const restSec = restSeconds;
  const restTargetSec = rawRestTargetSec ?? restSec ?? "";
  const restSecValue = restSec === "" ? "" : "0";
  const notesValue = rawNotes ?? "";

  const createdAt = isoNow();
  const updatedAt = createdAt;
  const setId = makeId("set");

  const headerUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!1:1`;

  const headerResp = await fetch(headerUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const headerJson = (await headerResp.json().catch(() => ({}))) as {
    values?: string[][];
  };

  if (!headerResp.ok) {
    return Response.json(
      { error: "Failed reading WorkoutSets headers", status: headerResp.status },
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

  const idxSetId = getIndex(["setid"], 0);
  const idxSessionId = getIndex(["sessionid"], 1);
  const idxUserEmail = getIndex(["useremail"], 2);
  const idxExerciseKey = getIndex(["exercisekey", "exerciseid", "exercise_key"], 3);
  const idxExerciseName = getIndex(["exercisename", "exercise_name"]);
  const idxExerciseOrder = getIndex(["exerciseorder", "exercise_order"]);
  const idxSetNumber = getIndex(["setnumber", "set_number"], 4);
  const idxReps = getIndex(["reps"], 5);
  const idxWeight = getIndex(["weight"], 6);
  const idxRpe = getIndex(["rpe"], 7);
  const idxRestSec = getIndex(["restsec", "restseconds", "rest_seconds"]);
  const idxRestTargetSec = getIndex(["resttargetsec", "resttargetseconds", "rest_target_seconds"]);
  const idxNotes = getIndex(["notes"]);
  const idxCreatedAt = getIndex(["createdat"], 8);
  const idxUpdatedAt = getIndex(["updatedat"], 9);
  const idxIsDeleted = getIndex(["isdeleted"], 10);

  const totalColumns = Math.max(
    headerRow.length,
    idxIsDeleted + 1,
    idxUpdatedAt + 1,
    idxCreatedAt + 1
  );
  const row = Array.from({ length: totalColumns }, () => "");

  if (idxSetId >= 0) row[idxSetId] = setId;
  if (idxSessionId >= 0) row[idxSessionId] = sessionId;
  if (idxUserEmail >= 0) row[idxUserEmail] = userEmail;
  if (idxExerciseKey >= 0) row[idxExerciseKey] = exerciseKey;
  if (idxExerciseName >= 0) row[idxExerciseName] = exerciseName;
  if (idxExerciseOrder >= 0) {
    row[idxExerciseOrder] = String(rawExerciseOrder ?? "");
  }
  if (idxSetNumber >= 0) row[idxSetNumber] = String(setNumber);
  if (idxReps >= 0) row[idxReps] = String(repsValue);
  if (idxWeight >= 0) row[idxWeight] = String(weightValue);
  if (idxRpe >= 0) row[idxRpe] = String(rpeValue);
  if (idxRestSec >= 0) row[idxRestSec] = String(restSecValue);
  if (idxRestTargetSec >= 0) row[idxRestTargetSec] = String(restTargetSec);
  if (idxNotes >= 0) row[idxNotes] = String(notesValue);
  if (idxCreatedAt >= 0) row[idxCreatedAt] = createdAt;
  if (idxUpdatedAt >= 0) row[idxUpdatedAt] = updatedAt;
  if (idxIsDeleted >= 0) row[idxIsDeleted] = "FALSE";

  const values = [row];

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A1:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    return Response.json(
      { error: "Sheets append failed", status: r.status, data },
      { status: r.status }
    );
  }

  return Response.json({ ok: true, setId });
}
