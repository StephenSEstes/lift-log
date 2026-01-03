import { google } from "googleapis";

export type WorkoutPlanRow = {
  plan_day: string;
  exercise_order: number;
  exercise_id: string;
  exercise_name: string;
  sets: number;
  target_rep_min: number;
  target_rep_max: number;
  youtube_url: string;
};

export type WorkoutSetRow = {
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
  rpe: string;
  notes: string;
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
    range: `${planSheet}!A1:H`,
  });
  const rows = result.data.values ?? [];
  const [, ...dataRows] = rows;

  return dataRows
    .filter((row) => row.length)
    .map((row) => ({
      plan_day: asString(row[0]),
      exercise_order: asNumber(row[1]),
      exercise_id: asString(row[2]),
      exercise_name: asString(row[3]),
      sets: asNumber(row[4]),
      target_rep_min: asNumber(row[5]),
      target_rep_max: asNumber(row[6]),
      youtube_url: asString(row[7]),
    }));
};

export const readWorkoutSets = async (accessToken: string) => {
  const sheets = getSheetsClient(accessToken);
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${setsSheet}!A1:L`,
  });
  const rows = result.data.values ?? [];
  const [, ...dataRows] = rows;

  return dataRows
    .filter((row) => row.length)
    .map((row) => ({
      session_id: asString(row[0]),
      set_timestamp: asString(row[1]),
      exercise_id: asString(row[2]),
      exercise_name: asString(row[3]),
      exercise_order: asNumber(row[4]),
      set_number: asNumber(row[5]),
      weight: asString(row[6]),
      reps: asString(row[7]),
      is_skipped: asString(row[8]),
      skip_reason: asString(row[9]),
      rpe: asString(row[10]),
      notes: asString(row[11]),
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
      row.notes,
      row.created_at,
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sessionsSheet}!A1:J`,
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
    row.notes,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${setsSheet}!A1:L`,
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
