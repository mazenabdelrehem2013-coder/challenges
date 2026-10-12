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

- **Server:** build the dashboard (`cd dashboard && npm run build`), then run the back end; it serves the dashboard from the same address. Set `JWT_SECRET` to a long random value, `NODE_ENV=production`, `DB_FILE` to a path on a persistent disk, and `CORS_ORIGINS` if the dashboard is hosted elsewhere. Put it behind HTTPS.
- **Phone app:** set `extra.apiUrl` in `mobile/app.json` (or `EXPO_PUBLIC_API_URL`) to the server's https address, run `npx eas-cli@latest init` to get a project id (needed for push notifications), then `npx eas-cli@latest build` and `submit` for Google Play and the App Store. Change `ios.bundleIdentifier` and `android.package` in `app.json` to your company's ids first.
- **People:** HR adds people from the dashboard (People page) and shares their first password; anyone can change theirs via `POST /api/me/password`.

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>` except login.

- `POST /auth/login`
- `GET /me`, `GET /profiles/:id`, `GET /feed`, `GET /leaderboard?scope=&period=`, `GET /notifications`, `GET /people?q=`
- `GET /challenges`, `GET /challenges/targets?scope=`, `POST /challenges`, `GET /challenges/:id`
- `POST /challenges/:id/accept | decline | progress | approve | reject | cancel | finish`, `POST /challenges/:id/entries/:entryId/review`
- Managers and HR: `GET /admin/overview | approvals | participation | leaderboard | export.csv | users | settings`, `GET /admin/org`
- HR and admins: `POST /admin/users`, `PATCH /admin/users/:id`, `POST|PATCH /admin/org/{regions,branches,departments,teams}`, `PUT /admin/settings`
