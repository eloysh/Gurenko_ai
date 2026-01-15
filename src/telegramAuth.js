// Validates Telegram Mini App initData on backend
// Official docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Implementation based on Telegram's algorithm: HMAC-SHA256 with bot token

import crypto from 'crypto';

export function parseInitData(initData) {
  if (!initData) return { user: null };
  const params = new URLSearchParams(initData);
  let user = null;
  try {
    const u = params.get('user');
    if (u) user = JSON.parse(u);
  } catch {
    user = null;
  }
  return {
    user,
    query_id: params.get('query_id') || null,
    auth_date: params.get('auth_date') ? Number(params.get('auth_date')) : null,
    start_param: params.get('start_param') || null,
  };
}

export function validateInitData(initData, botToken) {
  if (!initData) return { ok: false, reason: 'empty initData' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no hash' };

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const ok = crypto.timingSafeEqual(Buffer.from(calcHash), Buffer.from(hash));
  return ok ? { ok: true } : { ok: false, reason: 'hash mismatch' };
}
