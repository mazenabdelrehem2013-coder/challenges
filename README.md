# Challenges

An app where employees challenge each other (person, team, department, branch or region) to earn points, badges and leaderboard spots, with a web dashboard for managers and HR. The game rules are in [RULES.md](RULES.md).

| Folder | What it is |
|---|---|
| `backend/` | Node.js API with a SQLite database. Handles sign-in, the org chart, challenges, scoring, points, badges, push notifications and reports. |
| `dashboard/` | React web dashboard for managers and HR. |
| `mobile/` | Android and iOS app (Expo / React Native). |

## Run it locally

You need Node.js 20 or newer.

```bash
# 1. Back end (http://localhost:4000)
cd backend
npm install
npm run seed      # demo company; password for every demo account is demo1234
npm start

# 2. Dashboard (http://localhost:5173)
cd ../dashboard
npm install
npm run dev       # sign in as hr@example.com or manager@example.com

# 3. Phone app
cd ../mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-computer-ip>:4000 npx expo start
```

Scan the QR code with the Expo Go app on your phone (same Wi-Fi as your computer). Sign in as `sara@example.com`.

Demo accounts: `admin@example.com`, `hr@example.com`, `manager@example.com` (Design department), and employees such as `sara@`, `omar@`, `lina@`, `karim@`, `nour@example.com`.

## Tests

```bash
cd backend && npm test
cd mobile && npx tsc --noEmit
```

## Going live

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mazenabdelrehem2013-coder/challenges)

One server runs everything. After it's deployed:

- `https://<your-address>/` is the employee app (web version, works on any phone browser; "Add to Home Screen" makes it feel like an app).
- `https://<your-address>/admin` is the manager and HR dashboard.

**Free setup (Render + Supabase):**

1. Create a free project at [supabase.com](https://supabase.com). In Project Settings → API, copy the **Project URL** and the **service_role** (secret) key. The app keeps its database there, in a private storage bucket it creates by itself.
2. Press the Deploy to Render button above and sign in to Render (free, no card). Fill in `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 8 characters), `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, then deploy.
3. Sign in at `/admin` with that admin account, set up regions, branches, departments and teams in Org chart, then add people in People.

Free plan limits: the server sleeps after 15 minutes without visitors, so the first visit after that takes about a minute; Supabase pauses a free project after a week with no activity (one click wakes it). Changes are copied to Supabase within a few seconds, so a crash can lose only the last few seconds. For no sleeping, switch the Render service to a paid plan; nothing else changes.

Set `SEED_DEMO` to `true` only if you want the demo company instead of a clean start; its accounts all share the public password `demo1234`, so don't leave it running that way.

**Anywhere else:** build the `Dockerfile` and run it with a persistent volume at `/data` (or the two `SUPABASE_` settings instead), plus `JWT_SECRET` (a long random value), `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Put it behind HTTPS.

**Android and iPhone apps:** set `extra.apiUrl` in `mobile/app.json` to your live https address, change `ios.bundleIdentifier` and `android.package` to your company's ids, then run `npx eas-cli@latest init`, `npx eas-cli@latest build` and `npx eas-cli@latest submit`. This needs a free Expo account, a Google Play developer account ($25 once) and an Apple developer account ($99 a year).

**People:** HR adds people from the dashboard (People page) and shares their first password; anyone can change theirs via `POST /api/me/password`.

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>` except login.

- `POST /auth/login`
- `GET /me`, `GET /profiles/:id`, `GET /feed`, `GET /leaderboard?scope=&period=`, `GET /notifications`, `GET /people?q=`
- `GET /challenges`, `GET /challenges/targets?scope=`, `POST /challenges`, `GET /challenges/:id`
- `POST /challenges/:id/accept | decline | progress | approve | reject | cancel | finish`, `POST /challenges/:id/entries/:entryId/review`
- Managers and HR: `GET /admin/overview | approvals | participation | leaderboard | export.csv | users | settings`, `GET /admin/org`
- HR and admins: `POST /admin/users`, `PATCH /admin/users/:id`, `POST|PATCH /admin/org/{regions,branches,departments,teams}`, `PUT /admin/settings`
