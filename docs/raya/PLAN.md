# Raya Challenge: plan and gap analysis

Raya Challenge is built on top of the app that is already live (decided by Mazen on 14 Oct 2026): the Expo phone app, the React dashboard at `/admin`, and Firebase (Auth + Firestore) on the free Spark plan. Nothing that works today is replaced. The spec's FastAPI, PostgreSQL and Flutter stack is not used; this document lists every place where that matters and what we do instead.

## Architecture decisions

| Spec asks for | We use | Why |
|---|---|---|
| FastAPI back end | `shared/` modules that both apps import, plus `firestore.rules` | Free hosting with no server to run. The rules are the server-side check. |
| PostgreSQL with constraints and transactions | Firestore with deterministic document ids, create-only collections and transactions | Same guarantees for duplicates and append-only data (see the mapping below). |
| Flutter mobile app | Existing Expo / React Native app | Already built and going through Google Play review. Its web version is the PWA. |
| Next.js portal | Existing Vite React dashboard | Already live; TypeScript can be added file by file. |
| Versioned scoring logic with tests | `shared/scoring/` (pure, exact decimals, `ENGINE_VERSION`) | One engine for phone, dashboard and any future server. |
| Background jobs | Jobs run when HR or a manager has the dashboard open, and are idempotent | The free plan has no scheduled code. |
| Google Cloud, staging and production | A second free Firebase project for staging | Same setup, separate data. |

Product name, company name, logo and colours stay configurable. The Play listing is not renamed.

## How PostgreSQL guarantees map to Firestore

| Guarantee | Firestore equivalent |
|---|---|
| Unique constraint / idempotency key | The key is the document id. A second create with the same id fails in a transaction and in the rules. |
| Append-only `point_transactions`, `audit_logs` | Rules: `allow create` only, `allow update, delete: if false`. Corrections are new documents. |
| Foreign keys | Rules check that referenced documents exist (`exists()` / `get()`), as `orgMatchesTeam` already does. |
| Transactions | `runTransaction` / `writeBatch`, already used for scoring a challenge. |
| Decimal precision | The engine computes with exact fixed-point BigInt and stores rounded values plus the policy's precision. |
| Frozen finalized months | A finalized period is a snapshot document (inputs, policy and template versions, results, fingerprint) that rules make read-only. |

## Gap analysis

What exists today: peer challenges between people, teams, departments, branches and regions; approvals; progress logging with proof links; a points ledger; levels and badges; daily/weekly/monthly leaderboards; org chart; roles employee/manager/hr/admin; CSV export; notifications; account deletion.

| Spec area | Status | Work |
|---|---|---|
| 6 Scoring model (KPI, challenge, monthly, team) | **Done in this PR** (engine + tests) | Wire into the dashboard and app (phases 3 to 5). |
| 7 KPI templates (7 departments) | **Done as defaults** | HR editor for templates and versions. |
| 13 Data model | Partly (org, players, challenges, points) | Add employees' codes and managers, dated team memberships, KPI definitions/templates/results, policies, periods, monthly results, assignments, evidence, badges, rewards, redemptions, appeals, audit logs. |
| 4 Roles | Partly (no sysadmin, admin = HR+owner) | Add `sysadmin`; keep `admin` as HR plus role assignment. |
| 4 Restricting employee data | **Gap**: every signed-in user can read all `players` | Split public profile (name, team, badges) from private HR fields. |
| Sign-in | Employees use anonymous sign-in with a name | Recommend HR-created employees (employee code + email link or password) so results belong to a real, verified person. Anonymous join can stay for the casual game. |
| 5 Dated memberships, transfers | Gap | `teamMemberships` collection; engine already scores by it. |
| 9 Wallet and rewards catalog | Ledger exists; catalog, redemptions, budgets missing | Engine has ledger, budget, stock and refund rules. |
| 10 Badges and HR recognition | Fixed game badges | Configurable badge criteria with versions, nominations, HR awards. |
| 11 Monthly workflow, evidence review | Proof links reviewed by managers | Period states (draft, published, calculating, review, finalized), assignments, evidence queue with reasons. |
| 12 Anti-manipulation | Rules + approvals | Engine has duplicate import, duplicate evidence and suspicion flags; add review queue. |
| 14 REST API + OpenAPI | `shared/client.js` routes (same shapes) | Add the spec's routes to the client; document them in `docs/raya/API.md`. |
| 15 Screens | About half exist | New: KPI score, team board, wallet, rewards, recognition feed, monthly history, appeals; HR: templates, policy, challenge builder, periods, appeals, anomalies, audit. |
| 16 Notifications | In-app list | Push needs a sender (see limits). |
| 17 Reports, Excel | CSV only | Monthly report pack, Excel via SheetJS in the browser. |
| 18 Security | Rules, HTTPS by Firebase | Rate limits via rules (per-day counters), App Check, backups (below). |
| 19 Tests | Game, rules, client tests | Scoring tests done; rules and end-to-end tests per phase. |

## What the free Firebase plan cannot do, and the closest safe alternative

1. **No server code, so official scores are calculated in HR's browser.** The engine is deterministic and every finalized month stores its inputs and a fingerprint, so anyone (and an automated check in CI) can re-run it and see whether the stored numbers match. Rules only let HR write results, and every write leaves an audit entry. What this cannot stop is a dishonest HR account writing wrong numbers; it can only make that visible. The full fix is Cloud Functions, which needs the pay-as-you-go Blaze plan (it has a free monthly allowance, but needs a card).
2. **No scheduled jobs.** Monthly calculation, deadline reminders and expiry run when HR or a manager opens the dashboard, and use idempotency keys so running twice does nothing. A GitHub Actions schedule can also run them daily with the existing service account, for free.
3. **Private evidence files.** New Firebase Storage buckets require the Blaze plan (as far as I know from Firebase's 2024 change; to confirm when we get there). Until then evidence is a reference to an approved source record or an https link (as today), and files would need Blaze.
4. **Push notifications** need something to send them. Options: the dashboard sends Expo push messages when HR acts, or a GitHub Actions job sends due reminders. In-app notifications keep working.
5. **Email** needs a provider (for example a free SendGrid or Resend tier) called from GitHub Actions.
6. **Backups.** Managed Firestore backups need Blaze. Free alternative: a nightly GitHub Actions job exports every collection to JSON and stores it as a private artifact, with a tested restore script.
7. **Rate limiting** is done in rules (per-user daily counters) and with Firebase App Check rather than a server middleware.
8. **SSO.** Firebase Auth supports Google and Microsoft sign-in on the free plan; SAML/OIDC SSO needs Identity Platform (paid above a free tier).

## Phases

1. **Inspect and plan**: this document. Done.
2. **Foundation**: data model collections and rules (employees with codes, dated memberships, roles incl. sysadmin, private HR fields), staff sign-in, seed script with synthetic multi-department data, rules tests.
3. **Scoring engine**: `shared/scoring/` with tests. Done in this PR. Next: periods, policy and template versions stored in Firestore, calculate/finalize/correct from the dashboard.
4. **Challenge system**: challenge library and builder, eligibility, assignments, evidence submission and review, credits, points awards with idempotency keys.
5. **Interfaces**: employee screens (score, rank, wallet, badges, rewards, history, appeals) and manager/HR dashboards, with configurable branding.
6. **Integrate and test**: KPI CSV import, reports and Excel export, notifications, suspicion review, audit view, end-to-end tests.
7. **Deploy**: staging project, backup job, docs (user guide, HR guide, architecture, backup/restore).

Each phase is its own pull request. While the Google Play review is pending, merging to `main` deploys the website and rules; the phone build on Play is not affected, but I will flag any PR that changes what the live app does before it is merged.

## Assumptions

- Weights are stored as percentages (30 = 30%); KPI Score divides the weighted sum by 100.
- Official scores are rounded half-up to the policy's precision (default 2 decimals) at each stored step (KPI score, challenge score, member scores, team average), and the final score is calculated from those stored values so it can be re-derived exactly.
- An employee with no eligible challenges in a month is scored on KPIs alone (`whenNoChallenges: 'kpi_only'`), so nobody is penalised for challenges that do not apply to them. HR can switch this to counting 0.
- The team for a month is the one the employee spent the most days in; a tie goes to the newer team.
- Default eligibility (configurable, published with the policy): new starters with 15 days or fewer in the month, people on more than 10 days of approved leave, and anyone with incomplete KPI data are scored but not ranked and not counted in team averages; a member needs 15 days in the team; a team needs 3 eligible members and 50% participation in its team challenges to be ranked.
- Team scores now use the average of members' normalized scores, as the spec says (this replaces the earlier "exact total" rule for the official monthly board). Each member's exact score is still shown next to the team. The existing head-to-head game challenges keep their totals.
- An optional KPI with no data is left out and the other weights are rescaled; a required one blocks the score. An HR exception (approver and reason) can exclude a required KPI the same way.
- Overachievement never raises the official score; it pays wallet points (default 5 per % above target, at most 100 per KPI).
