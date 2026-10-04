import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot } from "./sites-env.mjs";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--persist-to" || !args[1])) {
  throw new Error("Usage: node scripts/migrate-local.mjs [--persist-to local-directory]");
}
const builtConfig = path.join(projectRoot, "dist/server/wrangler.json");
if (!existsSync(builtConfig)) throw new Error("Run npm run build before applying local migrations.");
const built = JSON.parse(readFileSync(builtConfig, "utf8"));
const database = built.d1_databases?.find(item => item.binding === "DB");
if (!database) throw new Error("The built Worker must contain the DB binding.");
const directory = path.join(projectRoot, ".sites-runtime/local-migrations");
mkdirSync(directory, { recursive: true });
const config = path.join(directory, "wrangler.json");
writeFileSync(config, JSON.stringify({
  name: "daling-local-migrations", compatibility_date: built.compatibility_date,
  d1_databases: [{ ...database, migrations_dir: path.join(projectRoot, "drizzle") }],
}, null, 2));
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
  "d1", "migrations", "apply", "DB", "--local", "--config", config,
  "--persist-to", path.resolve(projectRoot, args[1] ?? ".wrangler/state"),
], { cwd: projectRoot, stdio: "inherit", env: { ...process.env, CI: "true" } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
