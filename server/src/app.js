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
  app.register(rateLimit, { global: true, max: 3000, timeWindow: "1 minute" });

  const q = {
    game: db.prepare("SELECT * FROM games WHERE id = ?"),
    insGame: db.prepare("INSERT INTO games (id,label,host_hash,start_at,end_at,created_at,expires_at) VALUES (?,?,?,?,?,?,?)"),
    endGame: db.prepare("UPDATE games SET ended_at = ?, expires_at = MIN(expires_at, ? + ?) WHERE id = ? AND ended_at IS NULL"),
    nPlayers: db.prepare("SELECT COUNT(*) c FROM players WHERE game_id = ?"),
    getPlayer: db.prepare("SELECT * FROM players WHERE game_id = ? AND pid = ?"),
    upPlayer: db.prepare(`INSERT INTO players (game_id,pid,name,role,key,updated_at) VALUES (@g,@pid,@name,@role,@key,@t)
      ON CONFLICT (game_id,pid) DO UPDATE SET name=@name, role=@role, key=COALESCE(@key,key), updated_at=@t`),
    nOuts: db.prepare("SELECT COUNT(*) c FROM outs WHERE game_id = ?"),
    insOut: db.prepare("INSERT OR IGNORE INTO outs (game_id,key,runner_name,hunter_pid,hunter_name,t) VALUES (?,?,?,?,?,?)"),
    setHunterOnOut: db.prepare("UPDATE outs SET hunter_pid=?, hunter_name=? WHERE game_id=? AND key=? AND hunter_pid IS NULL"),
    counts: db.prepare(`SELECT
      (SELECT COUNT(*) FROM players WHERE game_id=@g AND role='hunter') hunters,
      (SELECT COUNT(*) FROM players WHERE game_id=@g AND role='runner' AND (key IS NULL OR key NOT IN (SELECT key FROM outs WHERE game_id=@g))) alive,
      (SELECT COUNT(*) FROM outs WHERE game_id=@g) caught`),
    board: db.prepare(`SELECT hunter_name name, COUNT(*) catches FROM outs
      WHERE game_id=? AND hunter_pid IS NOT NULL GROUP BY hunter_pid ORDER BY catches DESC, MIN(t) ASC LIMIT 10`),
    feed: db.prepare("SELECT t, hunter_name hunter, runner_name runner FROM outs WHERE game_id=? ORDER BY t DESC LIMIT 15"),
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

  const view = (g) => {
    const c = q.counts.get({ g: g.id });
    return {
      id: g.id, label: g.label, startAt: g.start_at, endAt: g.end_at,
      ended: g.ended_at != null, endedAt: g.ended_at,
      players: { hunters: c.hunters, alive: c.alive }, caught: c.caught,
      board: q.board.all(g.id), feed: q.feed.all(g.id),
      serverTime: now(),
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
      return view(existing);
    }
    let end = b.startAt + (b.headMin + b.durMin) * 60_000;
    if (b.endAt != null) end = Math.max(b.startAt, Math.min(end, b.endAt));
    q.insGame.run(id, b.label, sha(b.hostKey).toString("hex"), b.startAt, end, t, end + DAY);
    return reply.code(201).send(view(q.game.get(id)));
  });

  app.get("/v1/games/:id", { schema: { params: { type: "object", properties: { id: ID }, required: ["id"] } } }, async (req, reply) => {
    const g = q.game.get(req.params.id);
    if (!g) return reply.code(404).send({ error: "no such game" });
    noStore(reply);
    return view(g);
  });

  app.post("/v1/games/:id/events", {
    schema: {
      params: { type: "object", properties: { id: ID }, required: ["id"] },
      body: {
        type: "object", additionalProperties: false, required: ["pid", "name", "type"],
        properties: {
          pid: PID, name: NAME, type: { enum: ["join", "catch", "out"] },
          role: { enum: ["runner", "hunter"] }, code: CODE,
          runner: { type: "object", additionalProperties: false, required: ["name", "code"], properties: { name: NAME, code: CODE } },
        },
      },
    },
  }, async (req, reply) => {
    const g = q.game.get(req.params.id);
    if (!g) return reply.code(404).send({ error: "no such game" });
    const b = req.body, t = now();
    if (g.ended_at != null || t > g.end_at + GRACE_MS) return reply.code(409).send({ error: "ended" });
    if (pidLimited(b.pid)) return reply.code(429).send({ error: "slow down" });

    if (b.type === "join") {
      if (!b.role) return reply.code(400).send({ error: "role required" });
      if (b.role === "runner" && !b.code) return reply.code(400).send({ error: "code required for runners" });
      if (!q.getPlayer.get(g.id, b.pid) && q.nPlayers.get(g.id).c >= MAX_PLAYERS) return reply.code(422).send({ error: "game full" });
      q.upPlayer.run({ g: g.id, pid: b.pid, name: b.name, role: b.role, key: b.code ? `${b.name}#${b.code}` : null, t });
    } else {
      if (!q.getPlayer.get(g.id, b.pid)) return reply.code(422).send({ error: "join first" });
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
    q.endGame.run(now(), now(), DAY, g.id);
    return view(q.game.get(g.id));
  });

  const timer = setInterval(() => { q.purge.run(now()); }, purgeEveryMs);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); db.close(); });
  app.decorate("purgeNow", () => q.purge.run(now()).changes);
  return app;
}
