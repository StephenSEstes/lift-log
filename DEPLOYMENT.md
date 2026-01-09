# Deployment Guide (Vercel)

This repo is a Next.js workout tracker that uses NextAuth and Google Sheets. Follow these steps to deploy on Vercel so it works on a phone and for a few friends.

## 1) Prerequisites
- A Vercel account
- A Google account with access to the workout Google Sheet
- A Google Cloud project with OAuth 2.0 credentials (Web client)
- This repo pushed to GitHub (or another git provider connected to Vercel)

## 2) Vercel setup
1. In Vercel, click "New Project" and import this repo.
2. Framework preset: Next.js (Vercel will auto-detect).
3. Build command: `npm run build` (default).
4. Output directory: `.next` (default).
5. Set the environment variables (see section 3).
6. Deploy.

Tip: The app is responsive and should work on mobile once deployed. Share the Vercel URL with friends.

## 3) Required environment variables
Set these in Vercel Project Settings -> Environment Variables:
- `NEXTAUTH_URL`: Your production URL, e.g. `https://your-app-name.vercel.app`
- `NEXTAUTH_SECRET`: A long random string (32+ chars). Use `openssl rand -base64 32`.
- `GOOGLE_CLIENT_ID`: From Google Cloud OAuth client.
- `GOOGLE_CLIENT_SECRET`: From Google Cloud OAuth client.
- `SPREADSHEET_ID`: The Google Sheet ID (from the sheet URL).

Notes:
- Keep `NEXTAUTH_URL` exactly the deployed Vercel URL, without a trailing slash.
- Use the same environment variables for Production and Preview if you want Preview to work.

## 4) Google OAuth configuration (Vercel)
In Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs:

Authorized JavaScript origins:
- `https://your-app-name.vercel.app`

Authorized redirect URIs:
- `https://your-app-name.vercel.app/api/auth/callback/google`

If you use a custom domain, add it to both lists:
- `https://your-domain.com`
- `https://your-domain.com/api/auth/callback/google`

After updating OAuth settings, redeploy or wait a few minutes for changes to propagate.

## 5) Google Sheets sharing/permissions
The app reads and writes to a Google Sheet via the signed-in user.

Recommended setup:
1. Open the Google Sheet that stores workout data.
2. Share the sheet with the Google accounts that will use the app.
3. Ensure each user has edit access if they will log sets or update plans.

If you only want a few friends to use it:
- Keep the OAuth consent screen in "Testing" mode and add their emails as test users.
- Or switch to "In production" if you need more users.

## 6) Troubleshooting common auth and token issues

Symptom: "OAuthError" or "redirect_uri_mismatch"
- Check that the redirect URI in Google Cloud matches exactly:
  `https://your-app-name.vercel.app/api/auth/callback/google`
- Confirm `NEXTAUTH_URL` is the same origin.

Symptom: "Unauthorized" from API routes
- Verify `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXTAUTH_SECRET` are set.
- Make sure the signed-in user is in the OAuth test user list (if in Testing).

Symptom: "Missing required env vars"
- Check that `SPREADSHEET_ID` is set in Vercel.
- Confirm you set env vars for the correct environment (Production/Preview).

Symptom: Token errors or frequent re-auth prompts
- Confirm the OAuth consent screen is published or users are added as testers.
- Revoke and re-grant access in Google Account permissions if tokens are stale.

Symptom: Sheet reads work, writes fail
- Ensure the signed-in user has edit access to the Google Sheet.
- Confirm the sheet ID matches the intended workbook.

## Inviting Friends (25 users)
Checklist:
1. Share the Google Sheet with each friend (Editor access).
2. In Google Cloud OAuth consent screen settings, choose "Testing" and add test users, or set publishing status to "In production" for external users.
3. Confirm `NEXTAUTH_URL` matches the deployed Vercel domain exactly.
4. Ask friends to visit `/diagnostics` first and confirm `/api/me` and `/api/sheets/tabs` return success.
5. If they see invalid credentials or 403 errors:
   - Recheck they are added as test users (if in Testing mode).
   - Make sure their Google account has Sheet access.
   - Have them sign out and sign back in to refresh tokens.
