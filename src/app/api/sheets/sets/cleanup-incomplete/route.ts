import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export const runtime = "nodejs";

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

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requiredEnv = ["SPREADSHEET_ID", "SHEET_WORKOUT_SETS"];
    const missing = requiredEnv.filter((key) => !process.env[key]);
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing required env vars: ${missing.join(", ")}` },
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | {
          sessionId?: string;
        }
      | null;
    const sessionId = (body?.sessionId ?? "").toString().trim();
    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const spreadsheetId = process.env.SPREADSHEET_ID ?? "";
    const sheetName = process.env.SHEET_WORKOUT_SETS ?? "WorkoutSets";

    const headerUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values/${encodeURIComponent(sheetName)}!1:1`;
    const headerResp = await fetch(headerUrl, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const headerJson = (await headerResp.json().catch(() => ({}))) as {
      values?: string[][];
    };
    if (!headerResp.ok) {
      return NextResponse.json(
        { error: "Failed reading WorkoutSets headers" },
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

    const idxSessionId = getIndex(["sessionid"], 1);
    const idxExerciseKey = getIndex(["exercisekey", "exerciseid", "exercise_key"], 3);
    const idxSetNumber = getIndex(["setnumber", "set_number"], 4);
    const idxReps = getIndex(["reps"], 5);
    const idxIsSkipped = getIndex(["isskipped", "is_skipped"], 8);
    const idxIsDeleted = getIndex(["isdeleted", "is_deleted"]);

    if (idxSessionId < 0) {
      return NextResponse.json(
        { error: "WorkoutSets missing SessionId column." },
        { status: 500 }
      );
    }

    const rowsUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values/${encodeURIComponent(sheetName)}!A1:Z`;
    const rowsResp = await fetch(rowsUrl, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const rowsJson = (await rowsResp.json().catch(() => ({}))) as {
      values?: string[][];
    };
    if (!rowsResp.ok) {
      return NextResponse.json(
        { error: "Failed reading WorkoutSets rows" },
        { status: rowsResp.status }
      );
    }

    const rows = rowsJson.values ?? [];
    if (rows.length <= 1) {
      return NextResponse.json({ removedCount: 0 });
    }

    const totalColumns = rows.reduce(
      (max, row) => Math.max(max, row.length),
      headerRow.length
    );
    const toCellValue = (row: string[], idx: number) =>
      idx >= 0 ? asString(row[idx]) : "";
    const rowsToRemove: number[] = [];

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const rowSessionId = toCellValue(row, idxSessionId);
      if (rowSessionId !== sessionId) continue;
      if (idxIsDeleted >= 0 && toCellValue(row, idxIsDeleted) === "TRUE") continue;

      const exerciseKey = toCellValue(row, idxExerciseKey);
      const setNumber = toCellValue(row, idxSetNumber);
      const reps = toCellValue(row, idxReps);
      const isSkipped = toCellValue(row, idxIsSkipped);

      const isIncomplete =
        !exerciseKey || !setNumber || (!reps && isSkipped !== "TRUE");

      if (isIncomplete) {
        rowsToRemove.push(i + 1);
      }
    }

    if (!rowsToRemove.length) {
      return NextResponse.json({ removedCount: 0 });
    }

    const updateUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values:batchUpdate?valueInputOption=USER_ENTERED`;

    if (idxIsDeleted >= 0) {
      const colLetter = toColumnLetter(idxIsDeleted + 1);
      const data = rowsToRemove.map((rowNumber) => ({
        range: `${sheetName}!${colLetter}${rowNumber}`,
        values: [["TRUE"]],
      }));
      const resp = await fetch(updateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data }),
      });
      if (!resp.ok) {
        return NextResponse.json(
          { error: "Failed to mark rows as deleted." },
          { status: resp.status }
        );
      }
    } else {
      const lastCol = toColumnLetter(totalColumns);
      const emptyRow = Array.from({ length: totalColumns }, () => "");
      const data = rowsToRemove.map((rowNumber) => ({
        range: `${sheetName}!A${rowNumber}:${lastCol}${rowNumber}`,
        values: [emptyRow],
      }));
      const resp = await fetch(updateUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data }),
      });
      if (!resp.ok) {
        return NextResponse.json(
          { error: "Failed to clear incomplete rows." },
          { status: resp.status }
        );
      }
    }

    return NextResponse.json({ removedCount: rowsToRemove.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
