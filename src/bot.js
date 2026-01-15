import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { createMysticTask, getMysticTask } from './freepik.js';

export function createBot({
  botToken,
  channelUsername,
  webAppUrl,
  freepikApiKey,
  db,
}) {
  const bot = new Telegraf(botToken);

  const START_BONUS_CREDITS = Number(process.env.START_BONUS_CREDITS || 2);
  const REFERRAL_BONUS_CREDITS = Number(process.env.REFERRAL_BONUS_CREDITS || 1);

  // Simple packages (Stars -> credits). You can edit these later.
  const PACKS = [
    { id: 'p10', title: '10 генераций', credits: 10, stars: 49, description: 'Пак на 10 генераций' },
    { id: 'p30', title: '30 генераций', credits: 30, stars: 129, description: 'Пак на 30 генераций' },
    { id: 'p100', title: '100 генераций', credits: 100, stars: 399, description: 'Пак на 100 генераций' },
  ];

  let botUsername = null;
  bot.telegram.getMe().then((me) => {
    botUsername = me?.username || null;
  }).catch(() => {});

  const genState = new Map(); // userId -> { mode: 'await_prompt', aspect_ratio }

  function makeRefCode(userId) {
    // compact, stable and URL-safe
    return Number(userId).toString(36);
  }

  function parseStartParam(text) {
    const m = String(text || '').match(/^\/start(?:\s+(.+))?/);
    const param = (m?.[1] || '').trim();
    return param || null;
  }

  function ensureUser(from, referredBy = null) {
    const existing = db.getUser.get(from.id);
    db.upsertUser.run({
      user_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      joined_at: Date.now(),
      credits: START_BONUS_CREDITS,
      referred_by: referredBy,
    });
    return { user: db.getUser.get(from.id), isNew: !existing };
  }

  async function isSubscribed(userId) {
    // NOTE: getChatMember is only guaranteed to work if the bot is admin in the chat/channel.
    // See Bot API changelog note.
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
    const res = await axios.get(url, {
      params: {
        chat_id: channelUsername, // '@gurenko_kristina_ai'
        user_id: userId,
      },
      timeout: 15_000,
    });

    const status = res.data?.result?.status;
    return ['member', 'administrator', 'creator'].includes(status);
  }

  function gateKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.url('✅ Подписаться на канал', `https://t.me/${channelUsername.replace('@', '')}`)],
      [Markup.button.callback('🔄 Проверить подписку', 'check_sub')],
    ]);
  }

  function mainMenuKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('🎨 Генерация', 'gen')],
      [Markup.button.callback('📚 Промты', 'prompts')],
      [Markup.button.callback('👤 Профиль', 'profile'), Markup.button.callback('💫 Купить', 'buy')],
      [Markup.button.webApp('🌐 Открыть Mini App', webAppUrl)],
      [Markup.button.callback('🆘 Поддержка', 'help')],
    ]);
  }

  async function showGate(ctx) {
    return ctx.reply(
      `Чтобы пользоваться ботом, подпишись на канал: ${channelUsername}\n\nПосле подписки нажми «Проверить подписку».`,
      gateKeyboard()
    );
  }

  async function showMenu(ctx) {
    return ctx.reply(
      `Готово ✅\n\nВыбирай, что делаем:`,
      mainMenuKeyboard()
    );
  }

  bot.start(async (ctx) => {
    try {
      // Create/update user record + handle referral
      const startParam = parseStartParam(ctx.message?.text);
      let referredBy = null;
      let referrerUserId = null;
      if (startParam?.startsWith('ref_')) {
        referredBy = startParam;
        const code = startParam.replace('ref_', '').trim();
        const parsed = parseInt(code, 36);
        if (!Number.isNaN(parsed)) referrerUserId = parsed;
      }

      const { isNew } = ensureUser(ctx.from, referredBy);

      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);

      // referral bonus (only on first start, no self-ref)
      if (isNew && referrerUserId && referrerUserId !== ctx.from.id) {
        const already = db.hasReferral.get(referrerUserId, ctx.from.id);
        if (!already) {
          db.insertReferral.run(referrerUserId, ctx.from.id, Date.now());
          db.addCredits.run(REFERRAL_BONUS_CREDITS, ctx.from.id);
          db.addCredits.run(REFERRAL_BONUS_CREDITS, referrerUserId);
          // try to notify referrer (ignore errors)
          bot.telegram.sendMessage(
            referrerUserId,
            `🎁 У тебя новый друг по ссылке! +${REFERRAL_BONUS_CREDITS} генерац(ии) добавлено в профиль.`
          ).catch(() => {});
        }
      }

      return showMenu(ctx);
    } catch (e) {
      return ctx.reply(
        'Не смог проверить подписку 🙈\n\nВажно: добавь бота админом в канал, иначе Telegram не даст проверить участников.'
      );
    }
  });

  // Required for payment disputes support
  bot.command('paysupport', async (ctx) => {
    return ctx.reply(
      '💬 Поддержка по оплате\n\nЕсли у тебя списались Stars, а генерации не начислились — пришли сюда скрин оплаты и свой @username. Мы разберёмся ✅'
    );
  });

  bot.action('check_sub', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return ctx.reply('Пока не вижу подписку 😌 Подпишись и нажми ещё раз.', gateKeyboard());
      return showMenu(ctx);
    } catch (e) {
      return ctx.reply(
        'Ошибка проверки подписки.\nПроверь, что бот админ в канале и канал указан правильно.'
      );
    }
  });

  bot.action('help', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply(
      `🆘 Поддержка\n\n• Генерация работает через Freepik API\n• Новые промты подтягиваются из твоего канала\n\nЕсли что-то не работает — напиши сюда: @gurenko_kristina (или замени на свой контакт).`
    );
  });

  bot.action('profile', async (ctx) => {
    await ctx.answerCbQuery();

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {
      // ignore
    }

    const { user } = ensureUser(ctx.from);
    const refCode = makeRefCode(ctx.from.id);
    const deepLink = botUsername
      ? `https://t.me/${botUsername}?start=ref_${refCode}`
      : `https://t.me/<YOUR_BOT_USERNAME>?start=ref_${refCode}`;

    const shareLink = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent('Держи бот с промтами и генерацией 🔥')}`;

    const text =
      `👤 *Профиль*\n\n` +
      `• ID: \`${user.user_id}\`\n` +
      `• @${user.username || 'без_ника'}\n` +
      `• Генерации: *${user.credits}*\n` +
      `• Потрачено Stars: *${user.total_spent_stars}*\n` +
      (user.last_result_url ? `\nПоследний результат: ${user.last_result_url}` : '') +
      `\n\n🔗 Твоя ссылка для друзей:\n${deepLink}`;

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('💫 Купить генерации', 'buy')],
      [Markup.button.url('🔗 Поделиться с другом', shareLink)],
      [Markup.button.webApp('🌐 Открыть Mini App', webAppUrl)],
    ]);

    return ctx.reply(text, { parse_mode: 'Markdown', ...kb });
  });

  function buyKeyboard() {
    return Markup.inlineKeyboard([
      ...PACKS.map((p) => [Markup.button.callback(`${p.title} — ${p.stars}⭐️`, `buy_pack:${p.id}`)]),
      [Markup.button.callback('⬅️ Назад', 'back_to_menu')],
    ]);
  }

  bot.action('buy', async (ctx) => {
    await ctx.answerCbQuery();

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {
      // ignore
    }

    ensureUser(ctx.from);
    return ctx.reply(
      '💫 Покупка генераций за Telegram Stars\n\nВыбери пакет:',
      buyKeyboard()
    );
  });

  bot.action('back_to_menu', async (ctx) => {
    await ctx.answerCbQuery();
    return showMenu(ctx);
  });

  bot.action(/buy_pack:(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const packId = String(ctx.match[1] || '').trim();
    const pack = PACKS.find((p) => p.id === packId);
    if (!pack) return ctx.reply('Пакет не найден 🙈');

    // gate
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) return showGate(ctx);
    } catch {
      // ignore
    }

    ensureUser(ctx.from);

    // Telegram Stars invoice: currency = XTR, provider_token can be empty for digital goods.
    const payload = `pack:${pack.id}`;
    await bot.telegram.sendInvoice(ctx.from.id, {
      title: pack.title,
      description: `${pack.description}. Начислим +${pack.credits} генераций.`,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: pack.title, amount: pack.stars }],
    });
  });

  bot.on('pre_checkout_query', async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch {
      // ignore
    }
  });

  bot.on('message', async (ctx, next) => {
    // handle successful stars payment
    const sp = ctx.message?.successful_payment;
    if (sp) {
      try {
        const payload = sp.invoice_payload || '';
        const totalStars = Number(sp.total_amount || 0);
        const chargeId = sp.telegram_payment_charge_id || null;

        const packId = payload.startsWith('pack:') ? payload.replace('pack:', '').trim() : null;
        const pack = PACKS.find((p) => p.id === packId);
        const creditsAdded = pack ? pack.credits : 0;

        ensureUser(ctx.from);
        if (creditsAdded > 0) {
          db.addCredits.run(creditsAdded, ctx.from.id);
        }
        if (totalStars > 0) {
          db.addSpentStars.run(totalStars, ctx.from.id);
        }
        db.insertPurchase.run(ctx.from.id, payload, totalStars, creditsAdded, chargeId, Date.now());

        await ctx.reply(
          `✅ Оплата прошла!\nНачислила: *+${creditsAdded}* генераций\nБаланс обновлён 🔥`,
          { parse_mode: 'Markdown', ...mainMenuKeyboard() }
        );
      } catch (e) {
        await ctx.reply('Оплата прошла, но я не смогла начислить генерации автоматически 🙈 Напиши /paysupport');
      }
      return;
    }
    return next();
  });

  bot.action('prompts', async (ctx) => {
    await ctx.answerCbQuery();
    const items = db.listPrompts.all(10);
    if (!items.length) return ctx.reply('Пока нет промтов. Добавь пост в канал и я подхвачу ✅');

    const text = items
      .map((p) => `#${p.id} — ${p.title || 'Промт'}\n${p.text.slice(0, 220)}${p.text.length > 220 ? '…' : ''}`)
      .join('\n\n');

    const kb = Markup.inlineKeyboard(
      items.slice(0, 5).map((p) => [Markup.button.callback(`Использовать #${p.id}`, `use_prompt:${p.id}`)])
    );

    return ctx.reply(`📚 Свежие промты:\n\n${text}`, kb);
  });

  bot.action(/use_prompt:(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = Number(ctx.match[1]);
    const row = db.db.prepare('SELECT id, text FROM prompts WHERE id=?').get(id);
    if (!row) return ctx.reply('Не нашла этот промт 🙈');

    genState.set(ctx.from.id, { mode: 'await_prompt', aspect_ratio: 'social_story_9_16', preset: row.text });
    return ctx.reply('Ок ✅ Отправь “ДА” чтобы сгенерировать по этому промту, или напиши новый промт текстом.');
  });

  bot.action('gen', async (ctx) => {
    await ctx.answerCbQuery();
    genState.set(ctx.from.id, { mode: 'await_prompt', aspect_ratio: 'social_story_9_16' });
    return ctx.reply(
      'Напиши промт для генерации (или отправь любой текст).\n\nПример: “ultra realistic portrait, soft daylight, editorial”'
    );
  });

  bot.on('text', async (ctx) => {
    const state = genState.get(ctx.from.id);
    if (!state?.mode) return;

    // Subscription gate for all actions
    try {
      const ok = await isSubscribed(ctx.from.id);
      if (!ok) {
        genState.delete(ctx.from.id);
        return showGate(ctx);
      }
    } catch {
      // ignore
    }

    const text = ctx.message.text?.trim();
    const prompt = text === 'ДА' && state.preset ? state.preset : text;

    genState.delete(ctx.from.id);

    if (!prompt) return ctx.reply('Пустой промт 😅 Попробуй ещё раз.');
    if (!freepikApiKey) return ctx.reply('Freepik API ключ не настроен в .env');

    // credits
    ensureUser(ctx.from);
    const spend = db.spendCredit.run(ctx.from.id);
    if (spend.changes === 0) {
      return ctx.reply(
        'На балансе нет генераций 😌\n\nПополнить можно за Stars:',
        buyKeyboard()
      );
    }

    await ctx.reply('Запускаю генерацию… ⏳');

    const createdAt = Date.now();
    try {
      const task = await createMysticTask({
        apiKey: freepikApiKey,
        prompt,
        aspect_ratio: state.aspect_ratio || 'social_story_9_16',
      });

      db.insertGen.run(ctx.from.id, prompt, state.aspect_ratio || 'social_story_9_16', task.task_id, 'IN_PROGRESS', createdAt);

      // Poll up to ~70 seconds
      const deadline = Date.now() + 70_000;
      let lastStatus = task.status;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        const status = await getMysticTask({ apiKey: freepikApiKey, taskId: task.task_id });
        lastStatus = status.status;

        if (status.status === 'COMPLETED' && status.generated?.length) {
          const url = status.generated[0];
          db.updateGen.run('COMPLETED', url, task.task_id);
          db.setLastResult.run(url, ctx.from.id);
          await ctx.replyWithPhoto(url, { caption: 'Готово ✅' });
          return;
        }

        if (status.status === 'FAILED') {
          db.updateGen.run('FAILED', null, task.task_id);
          db.addCredits.run(1, ctx.from.id); // refund
          return ctx.reply('Упс… генерация не получилась 😢 Попробуй другой промт.');
        }
      }

      return ctx.reply(`Генерация ещё в процессе (${lastStatus}).\nЯ не дождалась ответа по таймауту — попробуй повторить позже.`);

    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 350) : (e.message || 'error');
      db.addCredits.run(1, ctx.from.id); // refund
      return ctx.reply(`Ошибка генерации: ${msg}`);
    }
  });

  // Auto-ingest prompts from channel posts
  bot.on('channel_post', async (ctx) => {
    try {
      if (!ctx.channelPost?.text) return;
      if (ctx.channelPost.chat?.username && `@${ctx.channelPost.chat.username}` !== channelUsername) return;

      const raw = ctx.channelPost.text.trim();
      // Basic formatting: first line = title (if short), rest = prompt
      const lines = raw.split('\n');
      let title = null;
      let text = raw;
      if (lines[0] && lines[0].length <= 60 && lines.length >= 2) {
        title = lines[0].replace(/^#+\s*/,'').trim();
        text = lines.slice(1).join('\n').trim();
      }

      if (!text) return;
      db.insertPrompt.run(title, text, ctx.channelPost.message_id, Date.now());
    } catch {
      // ignore
    }
  });

  return bot;
}
