import { createPool } from "./repository.js";
import { seedDevelopment } from "./seed.js";

const pool = createPool();
try { await seedDevelopment(pool); process.stdout.write("development seed applied\n"); }
finally { await pool.end(); }
