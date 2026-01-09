import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

type SessionWithAccessToken = Session & { accessToken?: string };

export async function GET() {
  const session = await getServerSession(authOptions);
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken;

  if (!accessToken) {
    return Response.json(
      { error: "Missing Google access token" },
      { status: 401 }
    );
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    return Response.json(
      { error: "Missing SPREADSHEET_ID in .env.local" },
      { status: 500 }
    );
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await r.json();
  return Response.json(
    { status: r.status, data },
    { status: r.ok ? 200 : r.status }
  );
}
