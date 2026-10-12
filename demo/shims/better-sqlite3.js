// Minimal better-sqlite3 look-alike on top of sql.js, so the real back-end code runs in a browser.
// Expects globalThis.__SQL (the initialised sql.js module).

function normalize(params) {
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }
  _rows(params, limit) {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      stmt.bind(normalize(params));
      const out = [];
      while (stmt.step()) {
        out.push(stmt.getAsObject());
        if (limit && out.length >= limit) break;
      }
      return out;
    } finally {
      stmt.free();
    }
  }
  get(...params) {
    return this._rows(params, 1)[0];
  }
  all(...params) {
    return this._rows(params);
  }
  run(...params) {
    this.db.raw.run(this.sql, normalize(params));
    const changes = this.db.raw.getRowsModified();
    const id = this.db.raw.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
    return { changes, lastInsertRowid: id };
  }
}

export default class Database {
  constructor() {
    this.raw = new globalThis.__SQL.Database();
    this.depth = 0;
  }
  pragma(text) {
    if (/journal_mode/i.test(text)) return;
    this.raw.run(`PRAGMA ${text}`);
  }
  exec(sql) {
    this.raw.exec(sql);
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  transaction(fn) {
    return (...args) => {
      const name = `sp${this.depth++}`;
      this.raw.run(`SAVEPOINT ${name}`);
      try {
        const out = fn(...args);
        this.raw.run(`RELEASE ${name}`);
        return out;
      } catch (err) {
        this.raw.run(`ROLLBACK TO ${name}`);
        this.raw.run(`RELEASE ${name}`);
        throw err;
      } finally {
        this.depth--;
      }
    };
  }
}
