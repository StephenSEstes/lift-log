# Lift Log

Mobile-first weight training tracker powered by Google Sheets.

## Local setup

1) Install dependencies

```bash
npm install
```

2) Create `.env.local`

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXTAUTH_SECRET=your-nextauth-secret
SPREADSHEET_ID=your-spreadsheet-id
SHEET_WORKOUT_PLAN=WorkoutPlan
SHEET_WORKOUT_SESSIONS=WorkoutSessions
SHEET_WORKOUT_SETS=WorkoutSets
```

3) Run the dev server

```bash
npm run dev
```

Open `http://localhost:3000`.

## Google Cloud + OAuth setup

1) Create or pick a Google Cloud project.
2) Enable APIs:
   - Google Sheets API
3) Configure OAuth consent screen (External):
   - Add your Google account as a test user.
4) Create OAuth Client ID:
   - Application type: Web application
   - Authorized redirect URI:
     - `http://localhost:3000/api/auth/callback/google`
5) Copy the Client ID + Secret into `.env.local`.

## Google Sheets setup

Create a spreadsheet and add the following tabs (names must match `.env.local`).
Add header rows exactly as shown:

### WorkoutPlan

```
plan_day, exercise_order, exercise_id, exercise_name, sets, target_rep_min, target_rep_max, youtube_url
```

### WorkoutSessions

```
session_id, plan_day, start_timestamp, end_timestamp, timezone, exercises_planned, exercises_completed, total_sets_logged, notes, created_at
```

### WorkoutSets

```
session_id, set_timestamp, exercise_id, exercise_name, exercise_order, set_number, weight, reps, is_skipped, skip_reason, rpe, notes
```

Share the spreadsheet with the Google account you use to sign in.

## Notes

- Plan day defaults to the local weekday name (e.g. Monday). If no plan is found, pick an override on the plan screen.
- The app reads and writes directly using your Google OAuth access token.
