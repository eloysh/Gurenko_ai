const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  tg.ready();
  tg.setHeaderColor?.("#0b0f1a");
  tg.setBackgroundColor?.("#0b0f1a");
}

const API = {
  me: "/api/me",
  prompts: "/api/prompts",
  history: "/api/history",
  invoice: "/api/invoice",
  generate: "/api/generate",
};

const state = {
  me: null,
  prompts: [],
  history: [],
  packs: [
    { id: "p10", title: "10 генераций", credits: 10, stars: 49 },
    { id: "p30", title: "30 генераций", credits: 30, stars: 129 },
    { id: "p100", title: "100 генераций", credits: 100, stars: 399 },
  ],
};

function initDataHeader() {
  const initData = tg?.initData || "";
  return { "X-Telegram-InitData": initData };
}

async function apiGet(url) {
  const res = await fetch(url, { headers: initDataHeader() });
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...initDataHeader() },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

function $(id) { return document.getElementById(id); }

function setStatus(text) {
  $("statusText").textContent = text || "";
}

function formatName(u) {
  if (!u) return "—";
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || (u.username ? `@${u.username}` : "—");
}

function renderProfile() {
  const u = state.me?.user;
  $("meName").textContent = formatName(u);
  $("meCredits").textContent = u?.credits ?? "—";
  $("meSpent").textContent = u?.spent_stars ?? 0;

  const link = state.me?.deepLink || "";
  $("refLink").value = link || "Добавь BOT_USERNAME в Render Env";
  $("creditsPill").textContent = `⚡️ ${u?.credits ?? 0} генераций`;
}

function renderPrompts() {
  const wrap = $("promptsList");
  wrap.innerHTML = "";

  if (!state.prompts.length) {
    wrap.innerHTML = `<div class="item"><div class="itemTitle">Пока нет промтов</div><div class="itemText">Добавь посты в свой канал — бот их подтянет.</div></div>`;
    return;
  }

  for (const p of state.prompts) {
    const title = p.title || "Промт";
    const text = p.text || "";
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${escapeHtml(title)}</div>
        <div class="itemTitle">🔥</div>
      </div>
      <div class="itemText">${escapeHtml(text)}</div>
      <button class="btn btnSoft itemBtn">⚡️ Использовать</button>
    `;
    div.querySelector("button").onclick = () => {
      $("promptInput").value = text;
      setStatus("Промт вставлен ✅ Нажми «Сгенерировать»");
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    wrap.appendChild(div);
  }
}

function renderHistory() {
  const wrap = $("historyList");
  wrap.innerHTML = "";
  if (!state.history.length) {
    wrap.innerHTML = `<div class="hrow">Пока нет истории. Сделай первую генерацию ⚡️</div>`;
    return;
  }

  for (const h of state.history) {
    const div = document.createElement("div");
    div.className = "hrow";
    div.innerHTML = `<b>✅</b> ${escapeHtml(h.prompt || "")}<br/><span>${escapeHtml(h.status || "")}</span>`;
    wrap.appendChild(div);
  }
}

function renderPacks() {
  const wrap = $("packs");
  wrap.innerHTML = "";
  for (const p of state.packs) {
    const div = document.createElement("div");
    div.className = "pack";
    div.innerHTML = `
      <div class="packTitle">${p.title}</div>
      <div class="packMeta">+${p.credits} генераций • ${p.stars}⭐</div>
      <button class="btn btnPrimary packBtn">Купить за ${p.stars}⭐</button>
    `;
    div.querySelector("button").onclick = () => buyPack(p.id);
    wrap.appendChild(div);
  }
}

async function buyPack(packId) {
  try {
    setStatus("Открываю оплату Stars… ⭐️");
    const { url } = await apiPost(API.invoice, { pack_id: packId });
    // Telegram откроет инвойс
    tg?.openInvoice(url);
  } catch (e) {
    setStatus("Не получилось открыть оплату 😢");
    console.log(e);
  }
}

async function generate() {
  const prompt = $("promptInput").value.trim();
  const ratio = $("ratioSelect").value;

  if (!prompt) {
    setStatus("Напиши текст промта ✍️");
    return;
  }

  try {
    setStatus("Запускаю генерацию… ⏳");
    const data = await apiPost(API.generate, { prompt, aspect_ratio: ratio });
    if (data.url) {
      setStatus("Готово ✅ Фото уже в ответе сервера. (Можно отправлять в чат тоже)");
    } else {
      setStatus("Задача запущена ✅ Можно обновить историю позже.");
    }
    await refreshAll();
  } catch (e) {
    if (e?.error === "not_subscribed") {
      setStatus("Нужно подписаться на канал, чтобы пользоваться ✅");
      return;
    }
    if (e?.error === "no_credits") {
      setStatus("Закончились генерации ⚡️ Купи пакет Stars ⭐️");
      return;
    }
    setStatus("Ошибка генерации 😢");
    console.log(e);
  }
}

function openChannel() {
  const url = "https://t.me/gurenko_kristina_ai";
  tg?.openTelegramLink(url);
}

function shareBot() {
  const link = state.me?.deepLink || "";
  const bot = link ? link : "https://t.me/gurenko_ai_agent_bot";
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(bot)}&text=${encodeURIComponent("🔥 Забирай генерации и промты тут!")}`;
  tg?.openTelegramLink(shareUrl);
}

function shareChannel() {
  const channel = "https://t.me/gurenko_kristina_ai";
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(channel)}&text=${encodeURIComponent("✨ Подпишись, здесь новые промты каждый день!")}`;
  tg?.openTelegramLink(shareUrl);
}

async function shareToStory() {
  // В stories нужен media_url. Проще всего — отправить сториз с текстом без медиа не везде поддерживается.
  // Делаем безопасно: открываем шаринг канала (точно работает), а если shareToStory доступен — используем.
  const channel = "https://t.me/gurenko_kristina_ai";
  try {
    if (tg?.shareToStory) {
      // Можно подставить твой брендовый баннер если будет url картинки
      // Пока отправим ссылку через обычный share:
      tg.shareToStory(channel, { text: "Новые промты и генерации ⭐️" });
    } else {
      shareChannel();
    }
  } catch {
    shareChannel();
  }
}

async function refreshAll() {
  try {
    state.me = await apiGet(API.me);
    state.prompts = (await apiGet(API.prompts)).items || [];
    state.history = (await apiGet(API.history)).items || [];
    renderProfile();
    renderPrompts();
    renderHistory();
  } catch (e) {
    if (e?.error === "not_subscribed") {
      setStatus("Подпишись на канал @gurenko_kristina_ai ✅");
    } else {
      setStatus("Не удалось загрузить данные 😢");
    }
    console.log(e);
  }
}

// chips
document.querySelectorAll(".chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    const base = $("promptInput").value.trim();
    const add = btn.dataset.style || "";
    $("promptInput").value = base ? `${base}, ${add}` : add;
  });
});

// actions
$("generateBtn").onclick = generate;
$("openChannelBtn").onclick = openChannel;
$("shareBotBtn").onclick = shareBot;
$("shareChannelBtn").onclick = shareChannel;
$("storyBtn").onclick = shareToStory;

$("copyBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("refLink").value);
    setStatus("Ссылка скопирована ✅");
  } catch {
    setStatus("Не удалось скопировать 😢");
  }
};

$("openShopBtn").onclick = () => {
  $("shopCard").scrollIntoView({ behavior: "smooth" });
};

// bottom tabs
function setTab(activeId) {
  ["tabGen", "tabShop", "tabPrompts", "tabProfile"].forEach((id) => {
    $(id).classList.toggle("active", id === activeId);
  });
}

$("tabGen").onclick = () => { setTab("tabGen"); window.scrollTo({ top: 0, behavior: "smooth" }); };
$("tabShop").onclick = () => { setTab("tabShop"); $("shopCard").scrollIntoView({ behavior: "smooth" }); };
$("tabPrompts").onclick = () => { setTab("tabPrompts"); $("promptsList").scrollIntoView({ behavior: "smooth" }); };
$("tabProfile").onclick = () => { setTab("tabProfile"); $("profileBox").scrollIntoView({ behavior: "smooth" }); };

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// init
renderPacks();
refreshAll();
