// Every migration applies cleanly on an empty database, in order.
import { check, done, freshDb, migrationFiles } from "./harness.mjs";

const files = migrationFiles();
check("migration files are uniquely versioned", new Set(files.map((f) => f.slice(0, 14))).size === files.length, files);
let error = null;
try {
  await freshDb();
} catch (e) {
  error = e.message;
}
check("all migrations apply on a fresh database", error === null, error);
done();
