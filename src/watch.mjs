// Status watcher (opt-in): polls every registered service and posts a notification when one goes down or comes back.
// Enable with KI_WATCH_SECONDS=60 in ~/KI/.env (off by default). Only talks to loopback services (see status.mjs).
import { checkAll } from "./status.mjs";
import { addNotification } from "./notify.mjs";

const BAD = new Set(["down", "error"]);

// One poll. `memory` holds, per service, how many bad polls in a row and whether an alert was sent.
// An alert needs `failAfter` bad polls in a row, so one slow answer does not raise a false alarm.
export async function pollOnce(memory, { failAfter = 2, notify = addNotification, check = checkAll } = {}) {
  let list;
  try { list = await check(); } catch { return; }
  for (const s of list) {
    const m = memory.get(s.id) ?? { bad: 0, alerted: false };
    if (s.state === "disabled" || s.state === "skipped") {
      memory.set(s.id, { bad: 0, alerted: false });
      continue;
    }
    const name = String(s.name ?? s.id).slice(0, 90);
    if (BAD.has(s.state)) {
      m.bad += 1;
      if (m.bad >= failAfter && !m.alerted) {
        m.alerted = true;
        notify({
          level: s.state === "down" ? "error" : "warn", source: "status", title: `${name} is ${s.state}`,
          message: s.why ?? (s.http ? `HTTP ${s.http}` : null),
        }, { dedupe: true });
      }
    } else {
      if (m.alerted) notify({ level: "info", source: "status", title: `${name} is back`, message: null }, { dedupe: true });
      m.bad = 0;
      m.alerted = false;
    }
    memory.set(s.id, m);
  }
}

// Returns the timer, or null when KI_WATCH_SECONDS is not set.
export function startWatcher() {
  const sec = Number(process.env.KI_WATCH_SECONDS ?? 0);
  if (!(sec >= 1)) return null;
  const memory = new Map();
  const tick = () => { pollOnce(memory).catch(() => {}); };
  setTimeout(tick, Math.min(3000, sec * 1000)).unref();
  const t = setInterval(tick, sec * 1000);
  t.unref();
  return t;
}
