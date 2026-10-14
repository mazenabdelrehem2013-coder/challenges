# How Raya scores a month

Code: `shared/scoring/` (engine version in `policy.js`). Tests: `tests/scoring.test.js`.

Three things are kept apart:

1. **KPI score** (0 to 100): how well someone did on their job's measured results.
2. **Challenge score** (0 to 100): how many of the challenges that applied to them they completed.
3. **Points wallet**: points to spend on rewards. Points never change the official score.

## Individual

**Monthly score = 80% KPI score + 20% challenge score** (HR sets the split in a versioned policy).

Example: KPI 90, challenges 80 → 0.80 × 90 + 0.20 × 80 = **88**.

## KPI score

Each job has a KPI template whose weights add up to exactly 100%. KPI score = Σ weight × achievement ÷ 100.

| KPI type | Achievement |
|---|---|
| Higher is better (sales) | 100 × min(actual ÷ target, 1). 90M of a 100M target = 90; 120% of target = 100. |
| Lower is better (error rate) | 100 × min(target ÷ actual, 1). An actual of 0 scores 100. |
| Target of 0 (safety incidents) | HR picks a rule: pass/fail, or lose N points per incident. Without a rule, it is not scored. |
| Acceptable range | 100 inside the range, falling to 0 over a tolerance HR sets. |
| Bands (manager ratings) | The score of the band the result falls in. |

Missing, unapproved or invalid data is never counted as 0 or as 100. The month cannot be finalized until the data is approved or HR records an exception with a reason.

## Challenge score

Challenge score = 100 × credits earned ÷ credits available, capped at 100. Only challenges assigned to that person for that month count, and only approved (verified) completions earn credits. Someone with no challenges that apply to them is scored on KPIs alone.

## Team

**Team score = 70% team KPI score + 30% team challenge score.** Team KPI score is the average of the eligible members' KPI scores, and every member's score is shown.

Example: members 90, 80, 85, 95 → average 87.5; team challenges 90 → 0.70 × 87.5 + 0.30 × 90 = **88.25**.

New starters, people on long approved leave, people with incomplete data and people who moved in late in the month are scored but left out of rankings and team averages. Teams with fewer than 3 eligible members, or where fewer than half took part in team challenges, are not ranked. All of these limits are in the published policy.

## Leaderboards

People are ranked only against comparable people (same role, department or branch), by monthly score. Equal scores share a rank.

## Finalizing and corrections

When HR finalizes a month, the inputs, the policy and template versions and the results are frozen together with a fingerprint. Re-running the engine on that snapshot must give the same fingerprint. A correction (for example an upheld appeal) makes a new revision and an audit entry with the old and new values, who approved it and why; the original stays as it was. A new policy only applies to months that are not finalized yet.

## Points

Points are an append-only ledger. Each award has a key made from what it was for, so the same achievement cannot pay twice, and a mistake is undone with an opposite transaction, never by editing or deleting. Default awards (all configurable): learning module 50, certification 100, hard challenge 100 to 250, monthly role leaderboard win 300, team win 200 per eligible member, peer recognition 25 (capped per month), KPI overachievement up to 100 per KPI. A team win and an individual win are different achievements, so both pay unless HR turns stacking off.
