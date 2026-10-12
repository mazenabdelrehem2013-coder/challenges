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

**Render (one click):** press the button above, sign in to Render, and fill in `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 8 characters). That account is the first admin; sign in at `/admin`, set up regions, branches, departments and teams in Org chart, then add people in People. Render generates `JWT_SECRET` for you and keeps the database on a 1 GB disk, which needs the paid Starter plan (about $7 a month plus the disk). Set `SEED_DEMO` to `true` only if you want the demo company instead of a clean start; its accounts all share the public password `demo1234`, so don't leave it running that way.

**Anywhere else:** build the `Dockerfile` and run it with a persistent volume at `/data`, plus `JWT_SECRET` (a long random value), `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Put it behind HTTPS.

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
