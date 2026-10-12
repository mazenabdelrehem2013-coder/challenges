import { openDb } from './db.js';
import { createApp } from './app.js';
import { settleDue } from './game.js';

const db = openDb();
const app = createApp(db);
const port = Number(process.env.PORT) || 4000;

// Finish challenges whose end date has passed, once a minute.
setInterval(() => settleDue(db), 60 * 1000).unref();
settleDue(db);

app.listen(port, () => console.log(`Challenges API listening on http://localhost:${port}`));
