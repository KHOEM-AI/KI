// Backup of everything KI keeps (database + uploaded files) into a new folder outside the repo.
//   node ~/KI/scripts/backup.mjs            -> ~/KI-backups/ki-<UTC date and time>/
//   node ~/KI/scripts/backup.mjs <folder>   -> that folder
// Restore (stop KI first): copy ki.db to ~/.ki/ki.db and files/ to ~/.ki/files/, and delete ~/.ki/ki.db-wal and ki.db-shm.
import { backupTo, engine } from "../src/db.mjs";

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const dest = process.argv[2] ?? `${process.env.HOME ?? "."}/KI-backups/ki-${stamp}`;
try {
  const copied = backupTo(dest);
  console.log(`backup (${engine()}) -> ${dest}`);
  for (const c of copied) console.log("  " + c);
} catch (e) {
  console.error("backup failed:", e.message);
  process.exit(1);
}
