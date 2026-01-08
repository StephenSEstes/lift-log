import { google } from "googleapis";

export type WorkoutPlanRow = {
  userEmail: string;
  dayKey: string;
  sortOrder: number;
  exercise_id: string;
  exercise_name: string;
  plannedSets: number;
  defaultRestSeconds?: number;
  target_rep_min: number;
  target_rep_max: number;
  youtube_url: string;
};

export type WorkoutSetRow = {
  set_id?: string;
  session_id: string;
  set_timestamp: string;
  exercise_id: string;
  exercise_name: string;
  exercise_order: number;
  set_number: number;
  weight: string;
  reps: string;
  is_skipped: string;
  skip_reason: string;
  rpe?: string | number;
  rest_seconds: string;
  rest_target_seconds: string;
  notes: string;
  is_deleted?: string;
};

export type WorkoutSessionRow = {
  session_id: string;
  plan_day: string;
  start_timestamp: string;
  end_timestamp: string;
  timezone: string;
  exercises_planned: string;
  exercises_completed: string;
  total_sets_logged: string;
  default_rest_seconds: string;
  notes: string;
  created_at: string;
};

export type WorkoutExerciseNoteRow = {
  session_id: string;
  exercise_id: string;
  exercise_name: string;
  exercise_order: number;
  notes: string;
  updated_at: string;
};

const spreadsheetId = process.env.SPREADSHEET_ID ?? "";
const planSheet = process.env.SHEET_WORKOUT_PLAN ?? "WorkoutPlan";
const sessionsSheet = process.env.SHEET_WORKOUT_SESSIONS ?? "WorkoutSessions";
const setsSheet = process.env.SHEET_WORKOUT_SETS ?? "WorkoutSets";
const exerciseNotesSheet =
  process.env.SHEET_WORKOUT_EXERCISE_NOTES ?? "WorkoutExerciseNotes";

const asString = (value?: string | number) => (value ?? "").toString().trim();
const asNumber = (value?: string | number) => Number(value ?? 0);

const getSheetsClient = (accessToken: string) => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
};

export const readWorkoutPlan = async (accessToken: string) => {
  const sheets = getSheetsClient(accessToken);
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${planSheet}!A1:Z`,
  });
  const rows = result.data.values ?? [];
  const [headerRow, ...dataRows] = rows;

  const normalizeHeader = (value?: string | number) =>
    asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");

  const headerMap = new Map<string, number>();
  (headerRow ?? []).forEach((value, index) => {
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

  const idxUserEmail = getIndex(["useremail"]);
  const idxDayKey = getIndex(["daykey", "planday", "plan_day"]);
  const idxSortOrder = getIndex(["sortorder", "exerciseorder", "exercise_order"], 1);
  const idxExerciseKey = getIndex(["exercisekey", "exerciseid", "exercise_id"], 2);
  const idxPlannedSets = getIndex(["plannedsets", "sets"], 4);
  const idxDefaultRestSeconds = getIndex(["defaultrestseconds", "defaultrest"]);
  const idxExerciseName = getIndex(["exercisename", "exercise_name"], 3);
  const idxTargetRepMin = getIndex(["targetrepmin", "target_rep_min"], 5);
  const idxTargetRepMax = getIndex(["targetrepmax", "target_rep_max"], 6);
  const idxYoutubeUrl = getIndex(["youtubeurl", "youtube_url"], 7);

  return dataRows
    .filter((row) => row.length)
    .map((row) => ({
      userEmail: asString(idxUserEmail >= 0 ? row[idxUserEmail] : ""),
      dayKey: asString(idxDayKey >= 0 ? row[idxDayKey] : row[0]),
      sortOrder: asNumber(idxSortOrder >= 0 ? row[idxSortOrder] : row[1]),
      exercise_id: asString(idxExerciseKey >= 0 ? row[idxExerciseKey] : row[2]),
      exercise_name: asString(idxExerciseName >= 0 ? row[idxExerciseName] : row[3]),
      plannedSets: asNumber(idxPlannedSets >= 0 ? row[idxPlannedSets] : row[4]),
      defaultRestSeconds:
        idxDefaultRestSeconds >= 0
          ? asNumber(row[idxDefaultRestSeconds])
          : undefined,
      target_rep_min: asNumber(idxTargetRepMin >= 0 ? row[idxTargetRepMin] : row[5]),
      target_rep_max: asNumber(idxTargetRepMax >= 0 ? row[idxTargetRepMax] : row[6]),
      youtube_url: asString(idxYoutubeUrl >= 0 ? row[idxYoutubeUrl] : row[7]),
    }));
};

export const readWorkoutSets = async (accessToken: string) => {
  const sheets = getSheetsClient(accessToken);
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${setsSheet}!A1:Z`,
  });
  const rows = result.data.values ?? [];
  const [headerRow, ...dataRows] = rows;

  const normalizeHeader = (value?: string | number) =>
    asString(value).toLowerCase().replace(/[^a-z0-9]/g, "");

  const headerMap = new Map<string, number>();
  (headerRow ?? []).forEach((value, index) => {
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

  const idxSessionId = getIndex(["sessionid"], 0);
  const idxSetTimestamp = getIndex(["settimestamp", "createdat", "set_timestamp"], 1);
  const idxExerciseKey = getIndex(["exercisekey", "exerciseid", "exercise_id"], 2);
  const idxExerciseName = getIndex(["exercisename", "exercise_name"], 3);
  const idxExerciseOrder = getIndex(["exerciseorder", "exercise_order"], 4);
  const idxSetNumber = getIndex(["setnumber", "set_number"], 5);
  const idxWeight = getIndex(["weight"], 6);
  const idxReps = getIndex(["reps"], 7);
  const idxIsSkipped = getIndex(["isskipped", "is_skipped"], 8);
  const idxSkipReason = getIndex(["skipreason", "skip_reason"], 9);
  const idxRpe = getIndex(["rpe"], 10);
  const idxRestSeconds = getIndex(["restseconds", "rest_seconds", "restsec"], 11);
  const idxRestTargetSeconds = getIndex(["resttargetseconds", "rest_target_seconds"], 12);
  const idxNotes = getIndex(["notes"], 13);
  const idxSetId = getIndex(["setid"]);
  const idxIsDeleted = getIndex(["isdeleted", "is_deleted"]);

  return dataRows
    .filter((row) => row.length)
    .map((row) => ({
      set_id: idxSetId >= 0 ? asString(row[idxSetId]) : undefined,
      session_id: asString(row[idxSessionId]),
      set_timestamp: asString(row[idxSetTimestamp]),
      exercise_id: asString(row[idxExerciseKey]),
      exercise_name: asString(row[idxExerciseName]),
      exercise_order: asNumber(row[idxExerciseOrder]),
      set_number: asNumber(row[idxSetNumber]),
      weight: asString(row[idxWeight]),
      reps: asString(row[idxReps]),
      is_skipped: asString(row[idxIsSkipped]),
      skip_reason: asString(row[idxSkipReason]),
      rpe: asString(row[idxRpe]),
      rest_seconds: asString(row[idxRestSeconds]),
      rest_target_seconds: asString(row[idxRestTargetSeconds]),
      notes: asString(row[idxNotes]),
      is_deleted: idxIsDeleted >= 0 ? asString(row[idxIsDeleted]) : undefined,
    }));
};

export const readWorkoutSessions = async (accessToken: string) => {
  const sheets = getSheetsClient(accessToken);
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sessionsSheet}!A1:K`,
  });
  const rows = result.data.values ?? [];
  const [, ...dataRows] = rows;

  return dataRows
    .filter((row) => row.length)
    .map((row) => ({
      session_id: asString(row[0]),
      plan_day: asString(row[1]),
      start_timestamp: asString(row[2]),
      end_timestamp: asString(row[3]),
      timezone: asString(row[4]),
      exercises_planned: asString(row[5]),
      exercises_completed: asString(row[6]),
      total_sets_logged: asString(row[7]),
      default_rest_seconds: asString(row[8]),
      notes: asString(row[9]),
      created_at: asString(row[10]),
    }));
};

export const appendSession = async (
  accessToken: string,
  row: WorkoutSessionRow
) => {
  const sheets = getSheetsClient(accessToken);
  const values = [
    [
      row.session_id,
      row.plan_day,
      row.start_timestamp,
      row.end_timestamp,
      row.timezone,
      row.exercises_planned,
      row.exercises_completed,
      row.total_sets_logged,
      row.default_rest_seconds,
      row.notes,
      row.created_at,
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sessionsSheet}!A1:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
};

export const appendSets = async (
  accessToken: string,
  rows: WorkoutSetRow[]
) => {
  if (!rows.length) return;
  const sheets = getSheetsClient(accessToken);
  const values = rows.map((row) => [
    row.session_id,
    row.set_timestamp,
    row.exercise_id,
    row.exercise_name,
    row.exercise_order,
    row.set_number,
    row.weight,
    row.reps,
    row.is_skipped,
    row.skip_reason,
    row.rpe,
    row.rest_seconds,
    row.rest_target_seconds,
    row.notes,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${setsSheet}!A1:N`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
};

export const appendExerciseNotes = async (
  accessToken: string,
  rows: WorkoutExerciseNoteRow[]
) => {
  if (!rows.length) return;
  const sheets = getSheetsClient(accessToken);
  const values = rows.map((row) => [
    row.session_id,
    row.exercise_id,
    row.exercise_name,
    row.exercise_order,
    row.notes,
    row.updated_at,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${exerciseNotesSheet}!A1:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
};
