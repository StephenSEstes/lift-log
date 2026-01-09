import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

type SessionWithAccessToken = Session & { accessToken?: string };

export async function GET() {
  const session = await getServerSession(authOptions);

  const userEmail = session?.user?.email ?? null;
  const accessToken = (session as SessionWithAccessToken | null)?.accessToken ?? null;
  const hasSpreadsheetId = !!process.env.SPREADSHEET_ID;

  return Response.json({
    signedIn: !!session,
    userEmail,
    hasAccessToken: !!accessToken,
    hasSpreadsheetId,
  });
}
