// Writes db/roadmap_seed.sql from the starting content in src/lib/roadmap-seed.ts:
//   npm run roadmap:seed-sql
import { writeFileSync } from "node:fs";
import { seedSql } from "../src/lib/roadmap-seed.ts";

writeFileSync(new URL("../db/roadmap_seed.sql", import.meta.url), seedSql());
console.log("Wrote db/roadmap_seed.sql");
