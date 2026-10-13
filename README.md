# Challenges

An app where employees challenge each other (person, team, department, branch or region) to earn points, badges and leaderboard spots, with a web dashboard for managers and HR. The game rules are in [RULES.md](RULES.md).

It runs on Firebase's free Spark plan: there is no server to look after.

| Folder | What it is |
|---|---|
| `mobile/` | Android and iOS app (Expo / React Native). Its web version is the employee website. |
| `dashboard/` | React web dashboard for managers and HR, at `/admin`. |
| `shared/` | The game rules (`game.js`) and the data layer both apps use (`client.js`), plus your Firebase settings (`firebase-config.js`). |
| `firestore.rules` | Who can read and change what in the database. This is what stops cheating. |
| `tests/` | Game rules, database rules, and full games played against the Firebase emulators. |

## How sign-in works

- **Employees** open the app, type their name and pick their team. No email or password: Firebase gives the phone an anonymous account and remembers it. (Signing out, or deleting the app, loses that account and its points, and the app warns about this.)
- **Managers and HR** sign in to the dashboard with an email and password. HR creates these sign-ins on the People page.
- **The first person** to open the dashboard on a new Firebase project creates the admin account.

## Data in Firestore

| Collection | Holds |
|---|---|
| `players/{uid}` | Name, role, team (with its department, branch and region), total points, won/lost/draw record, win streak, badges |
| `challenges/{id}` | The challenge, its sides, who accepted, status and result |
| `challenges/{id}/entries` | Progress each person logged (value, note, proof link) |
| `points` | Every point awarded, with the date: daily, weekly and monthly leaderboards are built from this |
| `regions`, `branches`, `departments`, `teams` | The org chart |
| `notifications`, `activity`, `settings/game`, `config/setup` | Alerts, the feed, game settings, and who owns the app |

Because the free plan has no server code, a finished challenge is scored when a manager or HR has the dashboard open (it checks when it opens and every minute after). "Finish now" on the Challenges page scores one straight away. Moving to the paid Blaze plan later would let a scheduled function do this instead.

## Set up your Firebase project (once)

1. Go to [console.firebase.google.com](https://console.firebase.google.com), **Add project**, and keep the free Spark plan.
2. **Build > Authentication > Get started**, then turn on **Anonymous** and **Email/Password**.
3. **Build > Firestore Database > Create database**, in **production mode**.
4. **Project settings > General > Your apps > Web (`</>`)**: register an app and copy the `firebaseConfig` values into `shared/firebase-config.js`.
5. Publish (below), open `https://<your-project>.web.app/admin` and create your admin account.
6. In the dashboard: Org chart (regions, branches, departments, teams), then People to add managers and HR. Share `https://<your-project>.web.app` with employees.

## Publish

```bash
npm install && (cd mobile && npm install) && (cd dashboard && npm install)
npx firebase login
npm run deploy                  # builds and publishes the website and the database rules
```

Or let GitHub do it: in Firebase console > Project settings > Service accounts, click **Generate new private key**, then in the repo's **Settings > Secrets and variables > Actions** add a secret named `FIREBASE_SERVICE_ACCOUNT` with the whole file's contents. Every push to `main` then runs the tests and publishes to the project in `.firebaserc`.

**Android and iPhone apps:** change `ios.bundleIdentifier` and `android.package` in `mobile/app.json` to your company's ids, then run `npx eas-cli@latest init`, `npx eas-cli@latest build` and `npx eas-cli@latest submit`. This needs a free Expo account, a Google Play developer account ($25 once) and an Apple developer account ($99 a year).

## Run it locally

You need Node.js 20+ and Java 21 (for the Firebase emulators).

```bash
npm install && (cd mobile && npm install) && (cd dashboard && npm install)
npm run emulators               # terminal 1
npm run seed                    # terminal 2: demo company
(cd dashboard && VITE_USE_EMULATORS=1 npm run dev)   # http://localhost:5173, sign in as hr@example.com / demo1234
(cd mobile && EXPO_PUBLIC_USE_EMULATORS=1 npx expo start)   # press w for the web version, or scan the QR code with Expo Go
```

On a phone, set `EXPO_PUBLIC_EMULATOR_HOST` to your computer's IP address so the app can reach the emulators.

## Tests

```bash
npm test                        # game rules, database rules, and full games against the emulators
(cd mobile && npx tsc --noEmit)
```
