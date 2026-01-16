import "dotenv/config";

import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import cors from "cors";
import axios from "axios";

import { initDb } from "./src/db.js";
import { createBot } from "./src/bot.js";
import { validateInitData, parseInitData } from "./src/telegramAuth.js";
import { createMysticTask, getMysticTask } from "./src/freepik.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "@gurenko_kristina_ai";
const WEBAPP_URL = process.env.WEBAPP_URL || ""; // важно задать в Render
const FREEPIK_API_KEY = process.env.FREEPIK_API_KEY || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "";

const START_BONUS_CREDITS = Number(process.env.START_BONUS_CREDITS || 2);
const ENABLE_CHANNEL_GATE = process.env.ENABLE_CHANNEL_GATE !== "0";

// Keep packs in sync with src/bot.js
const PACKS = [
  { id: "p10", title: "10 генераций", credits: 10, stars: 49, description: "Пак на 10 генераций" },
  { id: "p30", title: "30 генераций", credits: 30, stars: 129, description: "Пак на 30 генераций" },
  { id: "p100", title: "100 генераций", credits: 100, stars: 399, description: "Пак на 100 генераций" },
];

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing. Create bot via @BotFather and set BOT_TOKEN in .env / Render Env");
  process.exit(1);
}

// ---------- ESM safe __dirname ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- DB ----------
const db = initDb(process.env.SQLITE_PATH || "./data.sqlite");

// ---------- Express server (Mini App + API) ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------- Serve Mini App (ВАЖНО) ----------
/**
 * Должно быть:
 * src/miniapp/index.html
 * src/miniapp/style.css
 * src/miniapp/app.js
 */
const miniappDir = path.join(__dirname, "src", "miniapp");

// ассеты Mini App (css/js)
app.use("/miniapp-assets", express.static(miniappDir));

// страница Mini App
app.get("/miniapp", (req, res) => {
  res.sendFile(path.join(miniappDir, "index.html"));
});

// можно главную вести на miniapp
app.get("/", (req, res) => {
  res.redirect("/miniapp");
});

// health-check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---------- Subscription check ----------
async function isSubscribed(userId) {
  // Works reliably only when bot is admin in the channel.
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
  const res = await axios.get(url, {
    params: { chat_id: CHANNEL_USERNAME, user_id: userId },
    timeout: 15_000,
  });
  const status = res.data?.result?.status;
  return ["member", "administrator", "creator"].includes(status);
}

// ---------- Telegram WebApp auth middleware ----------
async function requireTelegramAuth(req, res, next) {
  const initData = req.header("X-Telegram-InitData") || "";
  const ok = validateInitData(initData, BOT_TOKEN);

  if (!ok.ok) return res.status(401).json({ error: "unauthorized", reason: ok.reason });

  req.tg = parseInitData(initData);

  const userId = req.tg?.user?.id;
  if (userId && ENABLE_CHANNEL_GATE) {
    try {
      const subOk = await isSubscribed(userId);
      if (!subOk) return res.status(403).json({ error: "not_subscribed" });
    } catch {
      // если проверка недоступна — не блокируем (как у тебя было)
    }
  }

  next();
}

// ✅ ВАЖНО: НЕ сбрасываем credits каждый раз!
function ensureUserFromTg(tgUser) {
  if (!tgUser?.id) return null;

  const existing = db.getUser.get(tgUser.id);

  // создаём только 1 раз
  if (!existing) {
    db.upsertUser.run({
      user_id: tgUser.id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      last_name: tgUser.last_name || null,
      joined_at: Date.now(),
      credits: START_BONUS_CREDITS,
      referred_by: null,
    });
  }

  return db.getUser.get(tgUser.id);
}

// ---------- API ----------
app.get("/api/prompts", requireTelegramAuth, (req, res) => {
  const items = db.listPrompts.all(20);
  res.json({ items });
});

app.get("/api/me", requireTelegramAuth, (req, res) => {
  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: "no_user" });

  const refCode = Number(user.user_id).toString(36);
  const deepLink = BOT_USERNAME
    ? `https://t.me/${BOT_USERNAME}?start=ref_${refCode}`
    : null;

  res.json({ user, deepLink });
});

app.get("/api/history", requireTelegramAuth, (req, res) => {
  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: "no_user" });

  const items = db.listHistory.all(user.user_id, 10);
  res.json({ items });
});

// ---------- Create invoice link (Telegram Stars) ----------
app.post("/api/invoice", requireTelegramAuth, async (req, res) => {
  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: "no_user" });

  const { pack_id } = req.body || {};
  const pack = PACKS.find((p) => p.id === pack_id);
  if (!pack) return res.status(400).json({ error: "pack_not_found" });

  try {
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`;
    const payload = `pack:${pack.id}`;

    const { data } = await axios.post(
      apiUrl,
      {
        title: pack.title,
        description: `${pack.description}. Начислим +${pack.credits} генераций.`,
        payload,
        provider_token: "",
        currency: "XTR", // Stars
        prices: [{ label: pack.title, amount: pack.stars }],
      },
      { timeout: 15_000 }
    );

    if (!data?.ok) return res.status(500).json({ error: "tg_error", data });

    return res.json({ url: data.result, pack });
  } catch (e) {
    return res.status(500).json({ error: "invoice_error", message: e.message });
  }
});

// ---------- Generate (Freepik Mystic) ----------
app.post("/api/generate", requireTelegramAuth, async (req, res) => {
  const { prompt, aspect_ratio } = req.body || {};

  if (!prompt?.trim()) return res.status(400).json({ error: "prompt_required" });
  if (!FREEPIK_API_KEY) return res.status(500).json({ error: "freepik_key_missing" });

  const user = ensureUserFromTg(req.tg?.user);
  if (!user) return res.status(400).json({ error: "no_user" });

  // spend 1 credit
  const spend = db.spendCredit.run(user.user_id);
  if (spend.changes === 0) return res.status(402).json({ error: "no_credits" });

  const createdAt = Date.now();

  try {
    const task = await createMysticTask({
      apiKey: FREEPIK_API_KEY,
      prompt: prompt.trim(),
      aspect_ratio: aspect_ratio || "social_story_9_16",
    });

    db.insertGen.run(
      user.user_id,
      prompt.trim(),
      aspect_ratio || "social_story_9_16",
      task.task_id,
      "IN_PROGRESS",
      createdAt
    );

    // quick polling up to 60s
    const deadline = Date.now() + 60_000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));

      const status = await getMysticTask({
        apiKey: FREEPIK_API_KEY,
        taskId: task.task_id,
      });

      if (status.status === "COMPLETED" && status.generated?.length) {
        const url = status.generated[0];

        db.updateGen.run("COMPLETED", url, task.task_id);
        db.setLastResult.run(url, user.user_id);

        return res.json({ ok: true, url });
      }

      if (status.status === "FAILED") {
        db.updateGen.run("FAILED", null, task.task_id);
        db.addCredits.run(1, user.user_id); // refund
        return res.status(500).json({ error: "gen_failed" });
      }
    }

    // timeout
    return res.json({ ok: true, task_id: task.task_id, status: "IN_PROGRESS" });
  } catch (e) {
    db.addCredits.run(1, user.user_id); // refund
    return res.status(500).json({ error: "gen_error", message: e.message });
  }
});

// ---------- Start server ----------
const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`✅ Web server listening on :${PORT}`);
  console.log(`✅ Mini App: /miniapp`);
});

// ---------- Telegram Bot ----------
const bot = createBot({
  botToken: BOT_TOKEN,
  channelUsername: CHANNEL_USERNAME,
  webAppUrl: WEBAPP_URL || `https://gurenko-ai.onrender.com/miniapp`,
  freepikApiKey: FREEPIK_API_KEY,
  db,
});

bot
  .launch()
  .then(() => console.log("✅ Bot started"))
  .catch((e) => console.error("❌ Bot launch error", e));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
