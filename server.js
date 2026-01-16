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
import { generateNanoBananaImage } from "./src/nanabanana.js";

// =================== ENV ===================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "@gurenko_kristina_ai";
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const BASE_URL = process.env.BASE_URL || ""; // https://gurenko-ai.onrender.com
const FREEPIK_API_KEY = process.env.FREEPIK_API_KEY || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "";
const GEMINI_API_
