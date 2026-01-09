import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import type { CreateSessionRequest } from "@/lib/types/sheetsRequests";

type SessionWithAccessToken = Session & { accessToken?: string };

function isoNow() {
  return new Date().toISOString();
}

function ymdLocal() {
  // YYYY-MM-DD in local time
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function makeId(prefix: string) {
  // Simple unique-ish id without extra libs
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken;
  const userEmail = session?.user?.email;

  if (!accessToken || !userEmail) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_WORKOUT_SESSIONS || "WorkoutSessions";

  if (!spreadsheetId) {
    return Response.json({ error: "Missing SPREADSHEET_ID" }, { status: 500 });
  }

  const expectedHeaders = [
    "SessionId",
    "UserEmail",
    "SessionDate",
    "WorkoutName",
    "CreatedAt",
    "UpdatedAt",
    "IsDeleted",
  ];

  const headerUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(`${sheetName}!A1:G1`)}?majorDimension=ROWS`;

  const headerResp = await fetch(headerUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const headerPayload = await headerResp.json().catch(() => ({}));
  const headerRow = Array.isArray(headerPayload?.values?.[0])
    ? (headerPayload.values[0] as string[])
    : [];

  const headerMatches =
    headerRow.length === expectedHeaders.length &&
    expectedHeaders.every((value, index) => headerRow[index] === value);

  if (!headerResp.ok || !headerMatches) {
    return Response.json(
      {
        error:
          "WorkoutSessions headers mismatch. Expected: " +
          expectedHeaders.join(", "),
        status: headerResp.status,
        headers: headerRow,
      },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => null)) as CreateSessionRequest | null;
  const { workoutName: rawWorkoutName, sessionDate: rawSessionDate } = body ?? {};
  const workoutName = (rawWorkoutName ?? "Workout").toString();
  const sessionDate = (rawSessionDate ?? ymdLocal()).toString();

  const createdAt = isoNow();
  const sessionId = makeId("sess");
  const updatedAt = createdAt;
  const isDeleted = "FALSE";

  const requiredFields = [
    { name: "SessionId", value: sessionId },
    { name: "UserEmail", value: userEmail },
    { name: "SessionDate", value: sessionDate },
    { name: "WorkoutName", value: workoutName },
    { name: "CreatedAt", value: createdAt },
    { name: "UpdatedAt", value: updatedAt },
    { name: "IsDeleted", value: isDeleted },
  ];

  const missingFields = requiredFields
    .filter((field) => !field.value)
    .map((field) => field.name);

  if (missingFields.length > 0) {
    return Response.json(
      {
        error: `Missing required fields: ${missingFields.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Must match headers:
  // SessionId,UserEmail,SessionDate,WorkoutName,CreatedAt,UpdatedAt,IsDeleted
  const values = [
    [
      sessionId,
      userEmail,
      sessionDate,
      workoutName,
      createdAt,
      updatedAt,
      isDeleted,
    ],
  ];

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(`${sheetName}!A:G`)}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

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
    return Response.json({ error: "Sheets append failed", status: r.status, data }, { status: r.status });
  }

  return Response.json({ ok: true, sessionId, sessionDate, workoutName });
}
