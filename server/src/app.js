import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { openDb } from "./db.js";

const DAY = 86_400_000;
const MAX_PLAYERS = 300;
const MAX_OUTS = 1000;
const GRACE_MS = 15 * 60_000;
const EVENTS_PER_MIN_PER_PID = 30;
// A phone that has not sent anything for this long is reported as unreachable
// (dead battery, no signal, app closed). Phones ping every ~30 s while open.
const STALE_MS = 120_000;

const ID = { type: "string", pattern: "^[a-z0-9]{4,12}$" };
const PID = { type: "string", pattern: "^[A-Za-z0-9_-]{6,32}$" };
const NAME = { type: "string", pattern: "^[^\\u0000-\\u001f<>&\"]{1,24}$" };
const CODE = { type: "string", pattern: "^[0-9]{4}$" };
const KEY = { type: "string", pattern: "^[A-Za-z0-9_-]{16,64}$" };

const sha = (s) => createHash("sha256").update(s).digest();
const sameKey = (hash, key) => timingSafeEqual(Buffer.from(hash, "hex"), sha(key));

export function buildApp({ dbPath = ":memory:", origins = [], now = () => Date.now(), purgeEveryMs = 3_600_000, logger = false } = {}) {
  const db = openDb(dbPath);
  const app = Fastify({ logger, bodyLimit: 4096, trustProxy: true, ajv: { customOptions: { removeAdditional: false } } });

  app.register(cors, {
    origin: origins.length ? origins : false,
    methods: ["GET", "PUT", "POST"],
    maxAge: 86400,
  });
  // Campus Wi-Fi puts hundreds of phones behind one IP, so the per-IP limit is
  // only a safety net against runaway clients; fairness is enforced per pid below.
  app.register(rateLimit, { global: true, max: 30000, timeWindow: "1 minute" });

  const q = {
    game: db.prepare("SELECT * FROM games WHERE id = ?"),
    insGame: db.prepare("INSERT INTO games (id,label,host_hash,start_at,head_end,end_at,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)"),
    endGame: db.prepare("UPDATE games SET ended_at = ?, end_reason = ?, expires_at = MIN(expires_at, ? + ?) WHERE id = ? AND ended_at IS NULL"),
    nPlayers: db.prepare("SELECT COUNT(*) c FROM players WHERE game_id = ?"),
    getPlayer: db.prepare("SELECT * FROM players WHERE game_id = ? AND pid = ?"),
    upPlayer: db.prepare(`INSERT INTO players (game_id,pid,name,role,key,updated_at,seen_at) VALUES (@g,@pid,@name,@role,@key,@t,@t)
      ON CONFLICT (game_id,pid) DO UPDATE SET name=@name, role=@role, key=COALESCE(@key,key), updated_at=@t, seen_at=@t`),
    seen: db.prepare("UPDATE players SET seen_at = ? WHERE game_id = ? AND pid = ?"),
    nOuts: db.prepare("SELECT COUNT(*) c FROM outs WHERE game_id = ?"),
    insOut: db.prepare("INSERT OR IGNORE INTO outs (game_id,key,runner_name,hunter_pid,hunter_name,t) VALUES (?,?,?,?,?,?)"),
    setHunterOnOut: db.prepare("UPDATE outs SET hunter_pid=?, hunter_name=? WHERE game_id=? AND key=? AND hunter_pid IS NULL"),
    counts: db.prepare(`SELECT
      (SELECT COUNT(*) FROM players WHERE game_id=@g) total,
      (SELECT COUNT(*) FROM players WHERE game_id=@g AND role='hunter') hunters,
      (SELECT COUNT(*) FROM players WHERE game_id=@g AND role='runner') runners,
      (SELECT COUNT(*) FROM players WHERE game_id=@g AND role='runner' AND (key IS NULL OR key NOT IN (SELECT key FROM outs WHERE game_id=@g))) alive,
      (SELECT COUNT(*) FROM players WHERE game_id=@g AND COALESCE(seen_at, updated_at) < @stale) unreachable,
      (SELECT COUNT(*) FROM outs WHERE game_id=@g) caught`),
    board: db.prepare(`SELECT hunter_name name, COUNT(*) catches FROM outs
      WHERE game_id=? AND hunter_pid IS NOT NULL GROUP BY hunter_pid ORDER BY catches DESC, MIN(t) ASC LIMIT 10`),
    feed: db.prepare("SELECT t, hunter_name hunter, runner_name runner FROM outs WHERE game_id=? ORDER BY t DESC LIMIT 15"),
    me: db.prepare(`SELECT p.role role,
      (SELECT MIN(t) FROM outs o WHERE o.game_id=p.game_id AND o.key=p.key) outAt,
      (SELECT COUNT(*) FROM outs o WHERE o.game_id=p.game_id AND o.hunter_pid=p.pid) catches
      FROM players p WHERE p.game_id=? AND p.pid=?`),
    purge: db.prepare("DELETE FROM games WHERE expires_at < ?"),
  };

  // Sliding window per player id, in memory. Campus Wi-Fi shares IPs, so IP alone is the wrong key.
  const hits = new Map();
  const pidLimited = (pid) => {
    const t = now();
    const arr = (hits.get(pid) || []).filter((x) => t - x < 60_000);
    arr.push(t);
    hits.set(pid, arr);
    return arr.length > EVENTS_PER_MIN_PER_PID;
  };
  const sweepHits = () => { const t = now(); for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 60_000) hits.delete(k); };

  const countsOf = (g) => q.counts.get({ g: g.id, stale: now() - STALE_MS });

  // Once every runner the server knows about is caught during the hunt, the
  // game is over for everyone: hunters win. Checked on every read and write
  // rather than on a timer so it is deterministic and survives restarts.
  const settle = (g) => {
    if (g.ended_at != null) return g;
    const t = now();
    if (t > g.end_at) return g; // time ran out; reported as timeUp below without locking the row (late reports still land)
    if (g.head_end != null && t < g.head_end) return g;
    const c = countsOf(g);
    if (c.runners >= 1 && c.alive === 0 && c.caught >= 1) {
      q.endGame.run(t, "allCaught", t, DAY, g.id);
      return q.game.get(g.id);
    }
    return g;
  };

  // `me` is this phone's own view (did a hunter log me? how many catches did I
  // get credit for?) so a phone that was dead or offline can catch up.
  const meView = (g, pid) => {
    if (!pid) return undefined;
    const m = q.me.get(g.id, pid);
    return m ? { role: m.role, outAt: m.outAt ?? null, catches: m.catches } : null;
  };

  const view = (g0, pid) => {
    const g = settle(g0);
    const c = countsOf(g), t = now();
    const ended = g.ended_at != null || t > g.end_at;
    let result = null;
    if (ended) {
      const reason = g.end_reason || (g.ended_at != null ? "host" : "timeUp");
      const winner = reason === "allCaught" ? "hunters" : reason === "timeUp" ? (c.alive > 0 ? "runners" : c.caught > 0 ? "hunters" : null) : null;
      result = { reason, winner };
    }
    return {
      id: g.id, label: g.label, startAt: g.start_at, endAt: g.end_at,
      ended, endedAt: g.ended_at, result,
      players: { hunters: c.hunters, alive: c.alive, runners: c.runners, total: c.total, unreachable: c.unreachable }, caught: c.caught,
      board: q.board.all(g.id), feed: q.feed.all(g.id),
      serverTime: t,
      ...(pid !== undefined ? { me: meView(g, pid) } : {}),
    };
  };

  const noStore = (reply) => reply.header("Cache-Control", "no-store");

  app.get("/healthz", async () => ({ ok: true }));

  app.put("/v1/games/:id", {
    schema: {
      params: { type: "object", properties: { id: ID }, required: ["id"] },
      body: {
        type: "object", additionalProperties: false,
        required: ["hostKey", "label", "startAt", "headMin", "durMin"],
        properties: {
          hostKey: KEY, label: { type: "string", minLength: 1, maxLength: 40, pattern: "^[^\\u0000-\\u001f<>&\"]+$" },
          startAt: { type: "integer" }, headMin: { type: "integer", minimum: 0, maximum: 60 },
          durMin: { type: "integer", minimum: 5, maximum: 240 }, endAt: { type: "integer" },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params, b = req.body, t = now();
    if (b.startAt < t - DAY || b.startAt > t + 30 * DAY) return reply.code(400).send({ error: "startAt out of range" });
    const existing = q.game.get(id);
    if (existing) {
      if (!sameKey(existing.host_hash, b.hostKey)) return reply.code(403).send({ error: "id taken" });
      noStore(reply);
      return view(existing);
    }
    let end = b.startAt + (b.headMin + b.durMin) * 60_000;
    if (b.endAt != null) end = Math.max(b.startAt, Math.min(end, b.endAt));
    const headEnd = Math.min(end, b.startAt + b.headMin * 60_000);
    q.insGame.run(id, b.label, sha(b.hostKey).toString("hex"), b.startAt, headEnd, end, t, end + DAY);
    noStore(reply);
    return reply.code(201).send(view(q.game.get(id)));
  });

  app.get("/v1/games/:id", {
    schema: {
      params: { type: "object", properties: { id: ID }, required: ["id"] },
      querystring: { type: "object", additionalProperties: false, properties: { pid: PID } },
    },
  }, async (req, reply) => {
    const g = q.game.get(req.params.id);
    if (!g) return reply.code(404).send({ error: "no such game" });
    noStore(reply);
    return view(g, req.query.pid);
  });

  app.post("/v1/games/:id/events", {
    schema: {
      params: { type: "object", properties: { id: ID }, required: ["id"] },
      body: {
        type: "object", additionalProperties: false, required: ["pid", "name", "type"],
        properties: {
          pid: PID, name: NAME, type: { enum: ["join", "catch", "out", "ping"] },
          role: { enum: ["runner", "hunter"] }, code: CODE,
          runner: { type: "object", additionalProperties: false, required: ["name", "code"], properties: { name: NAME, code: CODE } },
        },
      },
    },
  }, async (req, reply) => {
    let g = q.game.get(req.params.id);
    if (!g) return reply.code(404).send({ error: "no such game" });
    const b = req.body, t = now();
    g = settle(g);
    // After the end, late catch/out reports from phones that were offline still
    // land for a grace period (they only ever add or confirm outs). Joins and
    // pings are refused once the game is over.
    const lateReport = (b.type === "catch" || b.type === "out") && g.ended_at != null && t <= g.ended_at + GRACE_MS;
    if ((g.ended_at != null && !lateReport) || t > g.end_at + GRACE_MS) return reply.code(409).send({ error: "ended", result: view(g).result });
    if (pidLimited(b.pid)) return reply.code(429).send({ error: "slow down" });

    if (b.type === "join") {
      if (!b.role) return reply.code(400).send({ error: "role required" });
      if (b.role === "runner" && !b.code) return reply.code(400).send({ error: "code required for runners" });
      if (!q.getPlayer.get(g.id, b.pid) && q.nPlayers.get(g.id).c >= MAX_PLAYERS) return reply.code(422).send({ error: "game full" });
      q.upPlayer.run({ g: g.id, pid: b.pid, name: b.name, role: b.role, key: b.code ? `${b.name}#${b.code}` : null, t });
    } else {
      if (!q.getPlayer.get(g.id, b.pid)) return reply.code(422).send({ error: "join first" });
      q.seen.run(t, g.id, b.pid);
      if (b.type === "ping") return reply.code(204).send();
      if (q.nOuts.get(g.id).c >= MAX_OUTS) return reply.code(422).send({ error: "too many events" });
      if (b.type === "catch") {
        if (!b.runner) return reply.code(400).send({ error: "runner required" });
        const key = `${b.runner.name}#${b.runner.code}`;
        const r = q.insOut.run(g.id, key, b.runner.name, b.pid, b.name, t);
        if (!r.changes) q.setHunterOnOut.run(b.pid, b.name, g.id, key); // runner reported out first; credit the hunter
      } else {
        if (!b.code) return reply.code(400).send({ error: "code required" });
        q.insOut.run(g.id, `${b.name}#${b.code}`, b.name, null, null, t);
      }
      settle(g);
    }
    return reply.code(204).send();
  });

  app.post("/v1/games/:id/end", {
    schema: {
      params: { type: "object", properties: { id: ID }, required: ["id"] },
      body: { type: "object", additionalProperties: false, required: ["hostKey"], properties: { hostKey: KEY } },
    },
  }, async (req, reply) => {
    const g = q.game.get(req.params.id);
    if (!g) return reply.code(404).send({ error: "no such game" });
    if (!sameKey(g.host_hash, req.body.hostKey)) return reply.code(403).send({ error: "not the host" });
    q.endGame.run(now(), "host", now(), DAY, g.id);
    noStore(reply);
    return view(q.game.get(g.id));
  });

  const timer = setInterval(() => { q.purge.run(now()); sweepHits(); }, purgeEveryMs);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); db.close(); });
  app.decorate("purgeNow", () => q.purge.run(now()).changes);
  app.decorate("dbSizeBytes", () => db.prepare("SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()").get().b);
  return app;
}
