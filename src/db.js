import Database from 'better-sqlite3';

export function initDb(dbPath = './data.sqlite') {
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA journal_mode=WAL;

    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      joined_at INTEGER NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      total_spent_stars INTEGER NOT NULL DEFAULT 0,
      last_result_url TEXT,
      referred_by TEXT
    );

    CREATE TABLE IF NOT EXISTS referrals (
      referrer_user_id INTEGER NOT NULL,
      referred_user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(referrer_user_id, referred_user_id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      payload TEXT NOT NULL,
      stars INTEGER NOT NULL,
      credits_added INTEGER NOT NULL,
      telegram_charge_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      text TEXT NOT NULL,
      source_message_id INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      task_id TEXT,
      result_url TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Users
  const upsertUser = db.prepare(
    `INSERT INTO users(user_id, username, first_name, last_name, joined_at, credits, referred_by)
     VALUES (@user_id, @username, @first_name, @last_name, @joined_at, @credits, @referred_by)
     ON CONFLICT(user_id) DO UPDATE SET
       username=COALESCE(excluded.username, users.username),
       first_name=COALESCE(excluded.first_name, users.first_name),
       last_name=COALESCE(excluded.last_name, users.last_name)
    `
  );

  const getUser = db.prepare(
    'SELECT user_id, username, first_name, last_name, joined_at, credits, total_spent_stars, last_result_url, referred_by FROM users WHERE user_id=?'
  );

  const addCredits = db.prepare(
    'UPDATE users SET credits = credits + ? WHERE user_id=?'
  );

  const spendCredit = db.prepare(
    'UPDATE users SET credits = credits - 1 WHERE user_id=? AND credits > 0'
  );

  const setLastResult = db.prepare(
    'UPDATE users SET last_result_url=? WHERE user_id=?'
  );

  const addSpentStars = db.prepare(
    'UPDATE users SET total_spent_stars = total_spent_stars + ? WHERE user_id=?'
  );

  const insertReferral = db.prepare(
    'INSERT OR IGNORE INTO referrals(referrer_user_id, referred_user_id, created_at) VALUES (?, ?, ?)'
  );

  const hasReferral = db.prepare(
    'SELECT 1 FROM referrals WHERE referrer_user_id=? AND referred_user_id=?'
  );

  const insertPurchase = db.prepare(
    'INSERT INTO purchases(user_id, payload, stars, credits_added, telegram_charge_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const insertPrompt = db.prepare(
    'INSERT INTO prompts(title, text, source_message_id, created_at) VALUES (?, ?, ?, ?)'
  );

  const listPrompts = db.prepare(
    'SELECT id, COALESCE(title, "") as title, text, created_at FROM prompts ORDER BY id DESC LIMIT ?'
  );

  const insertGen = db.prepare(
    'INSERT INTO generations(user_id, prompt, aspect_ratio, task_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const updateGen = db.prepare(
    'UPDATE generations SET status=?, result_url=? WHERE task_id=?'
  );

  const listHistory = db.prepare(
    'SELECT id, prompt, aspect_ratio, result_url, status, created_at FROM generations WHERE user_id=? ORDER BY id DESC LIMIT ?'
  );

  return {
    db,
    upsertUser,
    getUser,
    addCredits,
    spendCredit,
    setLastResult,
    addSpentStars,
    insertReferral,
    hasReferral,
    insertPurchase,
    insertPrompt,
    listPrompts,
    insertGen,
    updateGen,
    listHistory,
  };
}
