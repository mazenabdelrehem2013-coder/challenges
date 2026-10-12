import { openDb } from './db.js';
import { createApp } from './app.js';
import { settleDue } from './game.js';
import { bootstrap } from './bootstrap.js';

const db = openDb();
const started = bootstrap(db);
if (started === 'demo') console.log('Filled the new database with the demo company (password demo1234).');
if (started === 'admin') console.log(`Created the first admin account: ${process.env.ADMIN_EMAIL}`);
if (started === 'empty') console.warn('The database has no users. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create the first admin.');
const app = createApp(db);
const port = Number(process.env.PORT) || 4000;

// Finish challenges whose end date has passed, once a minute.
setInterval(() => settleDue(db), 60 * 1000).unref();
settleDue(db);

app.listen(port, () => console.log(`Challenges API listening on http://localhost:${port}`));
