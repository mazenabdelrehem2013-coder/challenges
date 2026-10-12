import bcrypt from 'bcryptjs';
import { seed } from './seed.js';

// Gets a fresh database ready on first start:
// - SEED_DEMO=true fills it with the demo company (for trying things out only).
// - Otherwise ADMIN_EMAIL and ADMIN_PASSWORD create the first admin, who then
//   sets up regions, branches, departments and people from the dashboard.
export function bootstrap(db, env = process.env) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) return 'existing';
  if (env.SEED_DEMO === 'true') {
    seed(db);
    return 'demo';
  }
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD || '';
  if (!email || !password) return 'empty';
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');

  db.transaction(() => {
    const region = db.prepare('INSERT INTO regions (name) VALUES (?)').run('Main region').lastInsertRowid;
    const branch = db.prepare('INSERT INTO branches (name, region_id) VALUES (?, ?)').run('Head office', region).lastInsertRowid;
    const dept = db.prepare('INSERT INTO departments (name) VALUES (?)').run('Management').lastInsertRowid;
    const team = db
      .prepare('INSERT INTO teams (name, department_id, branch_id) VALUES (?, ?, ?)')
      .run('Management Head office', dept, branch).lastInsertRowid;
    db.prepare('INSERT INTO users (name, email, password_hash, role, title, team_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      'Admin',
      email,
      bcrypt.hashSync(password, 10),
      'admin',
      'System admin',
      team
    );
  })();
  return 'admin';
}
