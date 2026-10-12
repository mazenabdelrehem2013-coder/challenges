// Fills an empty database with a demo company so the app and dashboard have something to show.
// Usage: npm run seed   (refuses to run if the database already has users)
import bcrypt from 'bcryptjs';
import { openDb } from './db.js';
import { settleChallenge } from './game.js';

export const DEMO_PASSWORD = 'demo1234';

export function seed(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) throw new Error('Database already has users; not seeding.');
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const id = (info) => Number(info.lastInsertRowid);

  const run = db.transaction(() => {
    const region = {};
    for (const name of ['North', 'South']) region[name] = id(db.prepare('INSERT INTO regions (name) VALUES (?)').run(name));
    const branch = {};
    for (const [name, r] of [['Cairo', 'North'], ['Alexandria', 'North'], ['Aswan', 'South'], ['Luxor', 'South']]) {
      branch[name] = id(db.prepare('INSERT INTO branches (name, region_id) VALUES (?, ?)').run(`${name} branch`, region[r]));
    }
    const dept = {};
    for (const name of ['Design', 'Support', 'Sales', 'Marketing', 'Finance']) {
      dept[name] = id(db.prepare('INSERT INTO departments (name) VALUES (?)').run(name));
    }
    const team = {};
    const addTeam = (d, b) => {
      team[`${d}@${b}`] = id(db.prepare('INSERT INTO teams (name, department_id, branch_id) VALUES (?, ?, ?)').run(`${d} ${b}`, dept[d], branch[b]));
    };
    for (const d of Object.keys(dept)) for (const b of Object.keys(branch)) addTeam(d, b);

    const user = {};
    const addUser = (name, email, role, title, d, b) => {
      user[name] = id(
        db.prepare('INSERT INTO users (name, email, password_hash, role, title, team_id) VALUES (?, ?, ?, ?, ?, ?)').run(
          name, email, hash, role, title, team[`${d}@${b}`]
        )
      );
    };
    addUser('Admin', 'admin@example.com', 'admin', 'System admin', 'Finance', 'Cairo');
    addUser('Hana HR', 'hr@example.com', 'hr', 'HR lead', 'Finance', 'Cairo');
    addUser('Mona Manager', 'manager@example.com', 'manager', 'Design manager', 'Design', 'Cairo');
    const people = [
      ['Sara Adel', 'Design', 'Cairo'], ['Omar Hassan', 'Support', 'Cairo'], ['Lina Farouk', 'Design', 'Alexandria'],
      ['Karim Said', 'Sales', 'Alexandria'], ['Youssef Nabil', 'Marketing', 'Cairo'], ['Nour Ali', 'Marketing', 'Aswan'],
      ['Tarek Mostafa', 'Sales', 'Luxor'], ['Dina Samir', 'Finance', 'Aswan'], ['Ahmed Fathy', 'Support', 'Luxor'],
      ['Rana Kamal', 'Design', 'Cairo'],
    ];
    for (const [name, d, b] of people) {
      addUser(name, `${name.split(' ')[0].toLowerCase()}@example.com`, 'employee', `${d} specialist`, d, b);
    }
    return { region, branch, dept, team, user };
  });
  const org = run();

  // A finished challenge so there are results, points and badges to look at.
  const past = new Date(Date.now() - 3 * 864e5).toISOString();
  const soon = new Date(Date.now() + 4 * 864e5).toISOString();
  const yesterday = new Date(Date.now() - 864e5).toISOString();
  const c1 = id(
    db.prepare(
      `INSERT INTO challenges (title, type, scope, unit, judging, points, status, starts_at, ends_at, created_by)
       VALUES ('Read 2 books this month', 'learning', 'person', 'books', 'tracked', 150, 'active', ?, ?, ?)`
    ).run(past, yesterday, org.user['Lina Farouk'])
  );
  db.prepare("INSERT INTO challenge_sides (challenge_id, entity_id, response) VALUES (?, ?, 'accepted'), (?, ?, 'accepted')").run(
    c1, org.user['Lina Farouk'], c1, org.user['Karim Said']
  );
  db.prepare('INSERT INTO progress_entries (challenge_id, user_id, value) VALUES (?, ?, 2), (?, ?, 1)').run(
    c1, org.user['Lina Farouk'], c1, org.user['Karim Said']
  );
  settleChallenge(db, c1);

  // A running official branch-vs-branch challenge.
  const c2 = id(
    db.prepare(
      `INSERT INTO challenges (title, type, scope, unit, judging, points, reward, official, status, starts_at, ends_at, created_by, approved_by)
       VALUES ('October step challenge', 'fitness', 'branch', 'steps', 'tracked', 500, 'Extra day off', 1, 'active', ?, ?, ?, ?)`
    ).run(past, soon, org.user['Hana HR'], org.user['Hana HR'])
  );
  for (const b of Object.values(org.branch)) {
    db.prepare("INSERT INTO challenge_sides (challenge_id, entity_id, response) VALUES (?, ?, 'accepted')").run(c2, b);
  }
  const steps = db.prepare('INSERT INTO progress_entries (challenge_id, user_id, value) VALUES (?, ?, ?)');
  for (const [name, value] of [
    ['Sara Adel', 42000], ['Omar Hassan', 31500], ['Rana Kamal', 27250], ['Youssef Nabil', 18000],
    ['Lina Farouk', 51000], ['Karim Said', 36400], ['Nour Ali', 47800], ['Dina Samir', 29900], ['Tarek Mostafa', 22600],
  ]) {
    steps.run(c2, org.user[name], value);
  }

  // A peer challenge waiting for Sara to accept.
  const c3 = id(
    db.prepare(
      `INSERT INTO challenges (title, type, scope, unit, judging, points, status, starts_at, ends_at, created_by)
       VALUES ('Close 10 support tickets by Friday', 'work', 'person', 'tickets', 'tracked', 150, 'invited', ?, ?, ?)`
    ).run(new Date().toISOString(), soon, org.user['Omar Hassan'])
  );
  db.prepare("INSERT INTO challenge_sides (challenge_id, entity_id, response) VALUES (?, ?, 'accepted'), (?, ?, 'pending')").run(
    c3, org.user['Omar Hassan'], c3, org.user['Sara Adel']
  );

  // A department challenge waiting for HR approval.
  const c4 = id(
    db.prepare(
      `INSERT INTO challenges (title, type, scope, judging, points, status, starts_at, ends_at, created_by)
       VALUES ('Most customer kudos', 'work', 'department', 'manager', 200, 'pending_approval', ?, ?, ?)`
    ).run(new Date().toISOString(), soon, org.user['Tarek Mostafa'])
  );
  db.prepare("INSERT INTO challenge_sides (challenge_id, entity_id, response) VALUES (?, ?, 'accepted'), (?, ?, 'pending')").run(
    c4, org.dept.Sales, c4, org.dept.Support
  );
  return org;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb();
  seed(db);
  console.log(`Seeded demo data. Sign in with admin@example.com, hr@example.com, manager@example.com or sara@example.com — password "${DEMO_PASSWORD}".`);
}
