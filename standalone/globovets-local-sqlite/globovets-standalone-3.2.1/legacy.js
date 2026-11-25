// Запоминаем рабочую группу до обработки команд — это нужно для объявлений и напоминаний.
bot.use(async (ctx, next) => {
  try {
    if (ctx?.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
      const old = await db.collection("courier-session-booking").findOne({ key: "main" });
      const data = { ...(old?.data || {}), lastGroupChatId: ctx.chat.id, lastGroupChatTitle: ctx.chat.title || "", updatedAt: new Date().toISOString() };
      await db.collection("courier-session-booking").updateOne(
        { key: "main" },
        { $set: { key: "main", data, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (error) { console.error("Ошибка сохранения основного группового чата:", error.message); }
  return next();
});

// Счётчик команд и открытий статистики для секретных достижений.
bot.use(async (ctx,next)=>{
  try{
    const raw=String(ctx.message?.text||"").trim();
    if(raw && ctx.from?.id){
      const recognized=/^(?:\/|(?:г|б|а|э|л)\s*\+?\s*\d+|чай\s*\+?\s*\d+|мой день$|моя неделя$|мой месяц(?:\s|$)|календарь(?:\s|$)|топ(?:\s|$)|статистика$|цель\s+\d+|сравнить\s|достижения$|мои достижения$|топ достижений$|запись\s|логи\s|отмена\s|диамант\s*[+-]|золото\s*[+-])/i.test(raw);
      if(recognized){
        const state=await v3LoadEarningsState();
        const uid=String(ctx.from.id),day=v3DateISO(finalEarningsToday());
        state.achievementActivity=state.achievementActivity||{};
        state.achievementActivity[uid]=state.achievementActivity[uid]||{};
        state.achievementActivity[uid][day]=state.achievementActivity[uid][day]||{commands:0,statsOpens:0,goalChanges:0};
        state.achievementActivity[uid][day].commands=(Number(state.achievementActivity[uid][day].commands)||0)+1;
        if(/^(?:топ\s+чай|топ\s+неделя|топ\s+месяц|топ\s+день|мой день$|моя неделя$|мой месяц(?:\s|$))/i.test(raw)){
          state.achievementActivity[uid][day].statsOpens=(Number(state.achievementActivity[uid][day].statsOpens)||0)+1;
        }
        await finalEarningsSave(state);
        await v3CheckAchievements(uid);
      }
      if(ctx.chat && ["group","supergroup"].includes(ctx.chat.type)) await v3CheckChatAchievement(ctx);
    }
  }catch(error){console.error("Achievement activity counter:",error.message);}
  return next();
});


// ============================================================
// TELEGRAM БОТ ДЛЯ КУРЬЕРОВ — NxCreate
// ПОЛНАЯ ВЕРСИЯ
// ============================================================

// ВАЖНО:
// Этот файл рассчитан на ту же среду, что и твой исходный код,
// где переменные bot и db уже доступны.
// ============================================================


// ============================================================
// НАСТРОЙКИ
// ============================================================

const ADMIN_IDS = [5340322240];

const DB_COLLECTION = "courier-bot-state-v2";
const DB_KEY = "main";

const TABLE_NAME = "ПИДАРАСЫ";
const TIMEZONE = "Europe/Kyiv";

const MAX_PEOPLE_PER_DAY = 2;


// ============================================================
// ОБЩИЕ ФУНКЦИИ
// ============================================================

function isAdmin(ctx) {
  return ADMIN_IDS.includes(Number(ctx.from?.id));
}

bot.hears(/^техраб$/i, async ctx => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(
    "🛠️ <b>Внимание! Технические работы</b>\n\n" +
    "В боте «Глобовец» сейчас будут проводиться технические работы.\n\n" +
    "Большая просьба: временно не спамить сообщениями, на которые бот отвечает или которые обрабатывает. Это поможет избежать ошибок, задержек и потери данных.\n\n" +
    "Спасибо за понимание! 🙏",
    { parse_mode: "HTML" }
  );
  try { await ctx.deleteMessage(); }
  catch (error) { console.warn("Не удалось удалить сообщение «Техраб»:", error.message || error); }
});

bot.hears(/^оттех$/i, async ctx => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(
    "✅ <b>Технические работы завершены!</b>\n\n" +
    "Бот «Глобовец» снова в строю и готов к работе! 🚀\n\n" +
    "Спасибо за терпение и понимание. Если заметите ошибки или сбои, сообщите об этом администрации. 🙌",
    { parse_mode: "HTML" }
  );
  try { await ctx.deleteMessage(); }
  catch (error) { console.warn("Не удалось удалить сообщение «Оттех»:", error.message || error); }
});


function getNowKyiv() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: TIMEZONE
    })
  );
}


function getDateKey(date = getNowKyiv()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}


function getMonday(date = getNowKyiv()) {
  const d = new Date(date);
  const day = d.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);

  return d;
}


function getWeekKey(date = getNowKyiv()) {
  return getDateKey(getMonday(date));
}


function formatDate(date) {
  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}.${month}.${year}`;
}


function randomEmoji() {
  const emojis = [
    "👋",
    "🙂",
    "😎",
    "🚴",
    "🔥",
    "👍",
    "😄",
    "🤝"
  ];

  return emojis[Math.floor(Math.random() * emojis.length)];
}


// ============================================================
// ДНИ НЕДЕЛИ
// ============================================================

const DAYS = [
  {
    key: "mon",
    name: "Понедельник",
    short: "пн"
  },
  {
    key: "tue",
    name: "Вторник",
    short: "вт"
  },
  {
    key: "wed",
    name: "Среда",
    short: "ср"
  },
  {
    key: "thu",
    name: "Четверг",
    short: "чт"
  },
  {
    key: "fri",
    name: "Пятница",
    short: "пт"
  },
  {
    key: "sat",
    name: "Суббота",
    short: "сб"
  },
  {
    key: "sun",
    name: "Воскресенье",
    short: "вс"
  }
];


function getDayKey(date = getNowKyiv()) {
  const day = date.getDay();

  if (day === 1) return "mon";
  if (day === 2) return "tue";
  if (day === 3) return "wed";
  if (day === 4) return "thu";
  if (day === 5) return "fri";
  if (day === 6) return "sat";

  return "sun";
}


function getDayByInput(value) {
  if (!value) return null;

  const v = String(value).toLowerCase();

  return DAYS.find(
    d =>
      d.key === v ||
      d.short === v ||
      d.name.toLowerCase() === v
  ) || null;
}


// ============================================================
// НЕДЕЛИ ТАБЛИЦЫ
// ============================================================

function createEmptyWeek(weekKey) {
  return {
    weekKey,
    createdAt: Date.now(),

    days: {
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: []
    }
  };
}


// ============================================================
// ОСНОВНАЯ БАЗА
// ============================================================

async function loadState() {
  const collection = db.collection(DB_COLLECTION);

  const doc = await collection.findOne({
    key: DB_KEY
  });

  if (!doc || !doc.data) {
    const state = {
      currentWeek: createEmptyWeek(getWeekKey()),
      archive: [],
      codes: {},
      nameMarks: {},
      assignmentHistory: [],
      initializedAt: Date.now()
    };

    await collection.updateOne(
      {
        key: DB_KEY
      },
      {
        $set: {
          key: DB_KEY,
          data: state,
          updatedAt: Date.now()
        }
      },
      {
        upsert: true
      }
    );

    return state;
  }

  const state = doc.data;

  if (!state.currentWeek) {
    state.currentWeek = createEmptyWeek(getWeekKey());
  }

  if (!state.archive) {
    state.archive = [];
  }

  if (!state.codes) state.codes = {};
  if (!state.nameMarks || typeof state.nameMarks !== "object") state.nameMarks = {};
  if (!Array.isArray(state.assignmentHistory)) state.assignmentHistory = [];

  return state;
}


async function saveState(state) {
  const collection = db.collection(DB_COLLECTION);

  await collection.updateOne(
    {
      key: DB_KEY
    },
    {
      $set: {
        key: DB_KEY,
        data: state,
        updatedAt: Date.now()
      }
    },
    {
      upsert: true
    }
  );
}


// ============================================================
// АВТОМАТИЧЕСКАЯ СМЕНА НЕДЕЛИ
// ============================================================

async function ensureCurrentWeek(state) {
  const currentWeekKey = getWeekKey();

  if (!state.currentWeek) {
    state.currentWeek = createEmptyWeek(currentWeekKey);
    return true;
  }

  if (state.currentWeek.weekKey !== currentWeekKey) {
    const oldWeek = state.currentWeek;

    if (oldWeek && oldWeek.weekKey) {
      state.archive = state.archive || [];

      const exists = state.archive.some(
        w => w.weekKey === oldWeek.weekKey
      );

      if (!exists) {
        state.archive.unshift(oldWeek);
      }
    }

    state.currentWeek = createEmptyWeek(currentWeekKey);

    if (state.archive.length > 20) {
      state.archive = state.archive.slice(0, 20);
    }

    return true;
  }

  return false;
}


function getAssignmentBaseName(value) {
  return String(value || "").replace(/\s*х[23]\s*🔥?$/i, "").trim();
}
function getAssignmentMultiplier(value) {
  const match = String(value || "").match(/х([23])\s*🔥?$/i);
  return match ? Number(match[1]) : 1;
}
function getNameMarkKey(name) {
  return getAssignmentBaseName(name).toLocaleLowerCase("ru-RU");
}
function getNameMarkSuffix(state, name) {
  const item = (state.nameMarks || {})[getNameMarkKey(name)] || {};
  return (item.diamond ? " 💎" : "") + (item.gold ? " 🥇" : "");
}
function buildPreviousWeekLeaderText(state) {
  const previousWeek = (state.archive || [])
    .filter(week => week && week.weekKey && week.weekKey !== state.currentWeek?.weekKey)
    .sort((a, b) => String(b.weekKey).localeCompare(String(a.weekKey)))[0];
  if (!previousWeek || !previousWeek.days) return "";
  const scores = {};
  for (const day of DAYS) {
    for (const assignment of previousWeek.days[day.key] || []) {
      const name = getAssignmentBaseName(assignment);
      if (!name) continue;
      const key = name.toLocaleLowerCase("ru-RU");
      if (!scores[key]) scores[key] = { name, points: 0 };
      scores[key].name = name;
      scores[key].points += getAssignmentMultiplier(assignment);
    }
  }
  const rows = Object.values(scores);
  if (!rows.length) return "";
  const max = Math.max(...rows.map(row => row.points));
  const leaders = rows.filter(row => row.points === max);
  return "\n\n🔥 Главный пидор прошлой недели:\n" +
    leaders.map(row => "🔥 " + row.name + " — " + row.points + " очков").join("\n");
}
function recordAssignmentHistory(state, action, name, dayKey, multiplier = 1) {
  state.assignmentHistory = Array.isArray(state.assignmentHistory) ? state.assignmentHistory : [];
  state.assignmentHistory.push({
    at: new Date().toISOString(),
    weekKey: state.currentWeek?.weekKey || getWeekKey(),
    dayKey, name: getAssignmentBaseName(name), multiplier, action
  });
  if (state.assignmentHistory.length > 10000) state.assignmentHistory = state.assignmentHistory.slice(-10000);
}

// ============================================================
// 💳 ДОЛГИ ЗА НАЗНАЧЕНИЕ В ТАБЛИЦУ
// ============================================================
const DEBT_BASE_AMOUNT = 100;
const DEBT_REMINDER_HOURS = [14, 23];

function debtDateForAssignment(weekKey, dayKey) {
  const monday = new Date(String(weekKey) + "T12:00:00Z");
  const offset = DAYS.findIndex(day => day.key === dayKey);
  monday.setUTCDate(monday.getUTCDate() + Math.max(0, offset));
  return monday.toISOString().slice(0, 10);
}
function ensureDebtState(state) {
  state.debtLedger = state.debtLedger || { entries: [], history: [], reminders: {} };
  if (!Array.isArray(state.debtLedger.entries)) state.debtLedger.entries = [];
  if (!Array.isArray(state.debtLedger.history)) state.debtLedger.history = [];
  if (!state.debtLedger.reminders || typeof state.debtLedger.reminders !== "object") state.debtLedger.reminders = {};
  return state.debtLedger;
}
function debtAddOrUpdateAssignment(state, name, dayKey, multiplier, weekKey) {
  const ledger = ensureDebtState(state);
  const person = getAssignmentBaseName(name);
  const dateKey = debtDateForAssignment(weekKey || state.currentWeek?.weekKey || getWeekKey(), dayKey);
  let entry = ledger.entries.find(item => item.dateKey === dateKey && item.name.toLocaleLowerCase("ru-RU") === person.toLocaleLowerCase("ru-RU"));
  const amount = DEBT_BASE_AMOUNT * multiplier;
  if (entry) {
    const oldAmount = entry.amount;
    entry.amount = amount;
    entry.multiplier = multiplier;
    entry.status = "open";
    entry.updatedAt = new Date().toISOString();
    ledger.history.push({ action: "amount_updated", name: person, dateKey, oldAmount, amount, at: new Date().toISOString() });
  } else {
    entry = { id: dateKey + ":" + person.toLocaleLowerCase("ru-RU"), name: person, dateKey, amount, paid: 0, status: "open", multiplier, createdAt: new Date().toISOString() };
    ledger.entries.push(entry);
    ledger.history.push({ action: "debt_created", name: person, dateKey, amount, multiplier, at: new Date().toISOString() });
  }
  return entry;
}
function debtCancelAssignment(state, name, dayKey, weekKey) {
  const ledger = ensureDebtState(state);
  const person = getAssignmentBaseName(name);
  const dateKey = debtDateForAssignment(weekKey || state.currentWeek?.weekKey || getWeekKey(), dayKey);
  const entry = ledger.entries.find(item => item.dateKey === dateKey && item.name.toLocaleLowerCase("ru-RU") === person.toLocaleLowerCase("ru-RU") && item.status === "open");
  if (!entry) return null;
  entry.status = "cancelled";
  entry.cancelledAt = new Date().toISOString();
  ledger.history.push({ action: "debt_cancelled", name: person, dateKey, amount: entry.amount, paid: entry.paid || 0, at: new Date().toISOString() });
  return entry;
}
function debtApplyPayment(state, name, amount, adminId) {
  const ledger = ensureDebtState(state);
  const person = getAssignmentBaseName(name);
  const rows = ledger.entries.filter(item => item.status === "open" && item.name.toLocaleLowerCase("ru-RU") === person.toLocaleLowerCase("ru-RU") && item.amount > (item.paid || 0)).sort((a,b) => a.dateKey.localeCompare(b.dateKey));
  const total = rows.reduce((sum,item) => sum + item.amount - (item.paid || 0), 0);
  if (!rows.length || amount > total) return { ok: false, total };
  let remaining = amount;
  const allocations = [];
  for (const entry of rows) {
    if (remaining <= 0) break;
    const due = entry.amount - (entry.paid || 0);
    const applied = Math.min(due, remaining);
    entry.paid = (entry.paid || 0) + applied;
    remaining -= applied;
    if (entry.paid >= entry.amount) entry.status = "paid";
    allocations.push({ dateKey: entry.dateKey, amount: applied });
  }
  ledger.history.push({ action: "payment", name: person, amount, adminId: String(adminId), allocations, at: new Date().toISOString() });
  return { ok: true, total, remaining: total - amount };
}
function debtSummaryText(state) {
  const ledger = ensureDebtState(state);
  const open = ledger.entries.filter(item => item.status === "open" && item.amount > (item.paid || 0));
  const grouped = new Map();
  for (const item of open) {
    const key = item.name.toLocaleLowerCase("ru-RU");
    if (!grouped.has(key)) grouped.set(key, { name: item.name, total: 0, rows: [] });
    const person = grouped.get(key), due = item.amount - (item.paid || 0);
    person.total += due;
    person.rows.push({ dateKey: item.dateKey, due, paid: item.paid || 0, amount: item.amount });
  }
  const people = [...grouped.values()].sort((a,b) => b.total - a.total);
  if (!people.length) return "💳 ЗАДОЛЖЕННОСТИ\n\nДолгов нет. Все рассчитались! ✅";
  let message = "💳 ЗАДОЛЖЕННОСТИ\n━━━━━━━━━━━━━━\n";
  for (const person of people) {
    message += "\n👤 " + person.name + " — " + person.total + " грн\n";
    for (const row of person.rows) message += "• " + row.dateKey.split("-").reverse().join(".") + ": " + row.due + " грн" + (row.paid ? " (оплачено " + row.paid + " из " + row.amount + ")" : "") + "\n";
  }
  message += "\n━━━━━━━━━━━━━━\n💰 Общий долг: " + people.reduce((sum,p) => sum + p.total, 0) + " грн";
  return message;
}
bot.hears(/^долги$/i, async ctx => {
  try { const state = await loadState(); await ctx.reply(debtSummaryText(state)); }
  catch (error) { console.error("DEBT LIST ERROR:", error); await ctx.reply("❌ Не удалось загрузить задолженности."); }
});
bot.hears(/^оплачено\s+(.+?)\s+(\d+(?:[.,]\d{1,2})?)\s*$/i, async ctx => {
  if (!isAdmin(ctx)) return ctx.reply("Нет доступа ❌");
  const name = ctx.match[1].trim(), amount = Number(ctx.match[2].replace(",", "."));
  if (!name || !Number.isFinite(amount) || amount <= 0) return ctx.reply("Использование: Оплачено Имя Сумма");
  try {
    const state = await loadState(), result = debtApplyPayment(state, name, amount, ctx.from.id);
    if (!result.ok) return ctx.reply(result.total > 0 ? "❌ Сумма больше текущего долга. Остаток: " + result.total + " грн." : "❌ У этого человека нет открытого долга.");
    await saveState(state);
    await ctx.reply("✅ Оплата записана: " + name + " — " + amount + " грн.\nОстаток долга: " + result.remaining + " грн.");
  } catch (error) { console.error("DEBT PAYMENT ERROR:", error); await ctx.reply("❌ Не удалось записать оплату."); }
});
async function checkDebtReminders() {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const p = {}; for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
    if (p.minute !== "00" || !DEBT_REMINDER_HOURS.includes(Number(p.hour))) return;
    const slot = p.year + "-" + p.month + "-" + p.day + "-" + p.hour;
    const state = await loadState(), ledger = ensureDebtState(state);
    if (ledger.reminders[slot]) return;
    const session = await db.collection(SESSION_BOOKING_DB_COLLECTION).findOne({ key: SESSION_BOOKING_DB_KEY });
    if (!session?.data?.lastGroupChatId) return;
    await bot.telegram.sendMessage(session.data.lastGroupChatId, debtSummaryText(state));
    ledger.reminders[slot] = new Date().toISOString();
    await saveState(state);
  } catch (error) { console.error("DEBT REMINDER ERROR:", error.message || error); }
}
setInterval(checkDebtReminders, 30 * 1000);
setTimeout(checkDebtReminders, 7000);



// ============================================================
// ТАБЛИЦА
// ============================================================

function buildTableText(state) {
  const week = state.currentWeek;

  let text = `📋 ${TABLE_NAME}\n`;
  text += `━━━━━━━━━━━━━━\n`;
  text += `Неделя: ${formatDate(new Date(week.weekKey))}\n\n`;

  const today = getDayKey();

  for (const day of DAYS) {
    const people = week.days[day.key] || [];

    const marker = day.key === today ? "👉 " : "";

    text += `${marker}${day.name}`;

    if (people.length === 0) {
      text += ": —\n";
    } else {
      text += ":\n";

      people.forEach((person, index) => {
        const baseName = getAssignmentBaseName(person);
        text += `  ${index + 1}. ${person}${getNameMarkSuffix(state, baseName)}\n`;
      });
    }

    text += "\n";
  }

  text += "━━━━━━━━━━━━━━";
  text += buildPreviousWeekLeaderText(state);

  return text;
}


function tableKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "➕ Назначить",
          callback_data: "pid_n"
        },
        {
          text: "➖ Убрать",
          callback_data: "pid_u"
        }
      ],
      [
        {
          text: "📦 Архив",
          callback_data: "pid_archive"
        }
      ]
    ]
  };
}


async function sendTable(ctx) {
  try {
    const state = await loadState();

    const changed = await ensureCurrentWeek(state);

    if (changed) {
      await saveState(state);
    }

    await ctx.reply(
      buildTableText(state),
      {
        reply_markup: tableKeyboard()
      }
    );
  } catch (error) {
    console.error("TABLE ERROR:", error);

    await ctx.reply(
      "Ошибка загрузки таблицы ❌\n\n" +
      String(error.message || error)
    );
  }
}


// ============================================================
// АРХИВ ТАБЛИЦЫ
// ============================================================
//
// 0 = текущая неделя
// 1 = предыдущая
// 2 = неделя до неё
// и т.д.
//
// Текущая неделя открывается первой.
// ============================================================

function getArchiveWeekList(state) {
  const weeks = [];

  if (state.currentWeek && state.currentWeek.weekKey) {
    weeks.push(state.currentWeek);
  }

  for (const week of state.archive || []) {
    if (!week || !week.weekKey) continue;

    if (
      !weeks.some(
        item => item.weekKey === week.weekKey
      )
    ) {
      weeks.push(week);
    }
  }

  return weeks;
}


function buildArchiveTableText(week, isCurrent = false) {
  let text = `📦 ${TABLE_NAME} — АРХИВ\n`;
  text += `━━━━━━━━━━━━━━\n`;
  text += `Неделя: ${formatDate(new Date(week.weekKey))}`;

  if (isCurrent) {
    text += " 🟢";
  }

  text += "\n\n";

  for (const day of DAYS) {
    const people =
      (week.days && week.days[day.key]) || [];

    text += `${day.name}`;

    if (people.length === 0) {
      text += ": —\n";
    } else {
      text += ":\n";

      people.forEach((person, index) => {
        text += `  ${index + 1}. ${person}\n`;
      });
    }

    text += "\n";
  }

  text += "━━━━━━━━━━━━━━";

  return text;
}


function archiveKeyboard(index, total) {
  const rows = [];

  const navigation = [];

  // Более старая неделя
  if (index < total - 1) {
    navigation.push({
      text: "⬅️ Назад",
      callback_data: `pid_archive_${index + 1}`
    });
  }

  // Более новая неделя
  if (index > 0) {
    navigation.push({
      text: "➡️ Вперёд",
      callback_data: `pid_archive_${index - 1}`
    });
  }

  if (navigation.length > 0) {
    rows.push(navigation);
  }

  if (index !== 0) {
    rows.push([
      {
        text: "🔙 Текущая неделя",
        callback_data: "pid_archive_0"
      }
    ]);
  }

  return {
    inline_keyboard: rows
  };
}


async function showPidArchive(
  ctx,
  requestedIndex = 0,
  editMessage = false
) {
  const state = await loadState();

  const changed = await ensureCurrentWeek(state);

  if (changed) {
    await saveState(state);
  }

  const weeks = getArchiveWeekList(state);

  if (weeks.length === 0) {
    const message = "📦 Архив пуст";

    if (editMessage) {
      try {
        await ctx.editMessageText(message);
      } catch {
        await ctx.reply(message);
      }
    } else {
      await ctx.reply(message);
    }

    return;
  }

  let index = Number(requestedIndex);

  if (!Number.isInteger(index) || index < 0) {
    index = 0;
  }

  if (index >= weeks.length) {
    index = weeks.length - 1;
  }

  const week = weeks[index];

  const text = buildArchiveTableText(
    week,
    index === 0
  );

  const keyboard = archiveKeyboard(
    index,
    weeks.length
  );

  if (editMessage) {
    try {
      await ctx.editMessageText(
        text,
        {
          reply_markup: keyboard
        }
      );

      return;
    } catch (error) {
      console.error(
        "ARCHIVE EDIT ERROR:",
        error
      );
    }
  }

  await ctx.reply(
    text,
    {
      reply_markup: keyboard
    }
  );
}


// ============================================================
// START
// ============================================================

bot.command("start", async ctx => {
  await ctx.reply(
    "Привет " + randomEmoji()
  );
});


// ============================================================
// /P
// ============================================================

bot.command("p", async ctx => {
  await sendTable(ctx);
});


// ============================================================
// ПИДАРАСЫ
// ============================================================

bot.hears(/^пидapacы$/i, async ctx => {
  await sendTable(ctx);
});

bot.hears(/^ПИДАРАСЫ$/i, async ctx => {
  await sendTable(ctx);
});


// ============================================================
// /N — НАЗНАЧИТЬ
// ============================================================

bot.command("n", async ctx => {
  if (!isAdmin(ctx)) {
    await ctx.reply("Нет доступа ❌");
    return;
  }

  try {
    const args = ctx.message.text
      .trim()
      .split(/\s+/)
      .slice(1);

    if (args.length === 0) {
      await ctx.reply(
        "Использование:\n\n" +
        "/n Имя\n" +
        "/n пт Имя"
      );

      return;
    }

    let dayKey = getDayKey();
    let nameParts = args;

    const selectedDay =
      getDayByInput(args[0]);

    if (selectedDay) {
      dayKey = selectedDay.key;
      nameParts = args.slice(1);
    }

    const name =
      nameParts.join(" ").trim();

    if (!name) {
      await ctx.reply("Укажи имя ❌");
      return;
    }

    const state = await loadState();

    await ensureCurrentWeek(state);

    const people =
      state.currentWeek.days[dayKey] || [];

    if (people.length >= MAX_PEOPLE_PER_DAY) {
      await ctx.reply(
        `На ${DAYS.find(d => d.key === dayKey).name
        } уже назначено 2 человека ❌`
      );

      return;
    }

    const exists = people.some(
      person =>
        person.toLowerCase() ===
        name.toLowerCase()
    );

    if (exists) {
      await ctx.reply(
        `${name} уже назначен на этот день ⚠️\n\n` +
        `Для повторного назначения используй:\n` +
        `/nn ${name}`
      );

      return;
    }

    people.push(name);
    recordAssignmentHistory(state, "assign", name, dayKey, 1);
    debtAddOrUpdateAssignment(state, name, dayKey, 1, state.currentWeek.weekKey);

    state.currentWeek.days[dayKey] =
      people;

    await saveState(state);

    const dayName =
      DAYS.find(d => d.key === dayKey).name;

    await ctx.reply(
      `✅ Назначен\n\n` +
      `👤 ${name}\n` +
      `📅 ${dayName}`
    );
  } catch (error) {
    console.error(
      "ASSIGN ERROR:",
      error
    );

    await ctx.reply(
      "Ошибка назначения ❌\n\n" +
      String(error.message || error)
    );
  }
});


// ============================================================
// /U — УБРАТЬ
// ============================================================

bot.command("u", async ctx => {
  if (!isAdmin(ctx)) {
    await ctx.reply("Нет доступа ❌");
    return;
  }

  try {
    const args = ctx.message.text
      .trim()
      .split(/\s+/)
      .slice(1);

    if (args.length === 0) {
      await ctx.reply(
        "Использование:\n\n" +
        "/u Имя\n" +
        "/u пт Имя"
      );

      return;
    }

    let dayKey = getDayKey();
    let nameParts = args;

    const selectedDay =
      getDayByInput(args[0]);

    if (selectedDay) {
      dayKey = selectedDay.key;
      nameParts = args.slice(1);
    }

    const name =
      nameParts.join(" ").trim();

    if (!name) {
      await ctx.reply("Укажи имя ❌");
      return;
    }

    const state = await loadState();

    await ensureCurrentWeek(state);

    const people =
      state.currentWeek.days[dayKey] || [];

    const index = people.findIndex(
      person =>
        person.toLowerCase() ===
        name.toLowerCase()
    );

    if (index === -1) {
      await ctx.reply(
        `${name} не найден в этом дне ⚠️`
      );

      return;
    }

    const removed = people[index];
    recordAssignmentHistory(state, "remove", removed, dayKey, getAssignmentMultiplier(removed));
    debtCancelAssignment(state, removed, dayKey, state.currentWeek.weekKey);

    people.splice(index, 1);

    state.currentWeek.days[dayKey] =
      people;

    await saveState(state);

    const dayName =
      DAYS.find(d => d.key === dayKey).name;

    await ctx.reply(
      `✅ Убран\n\n` +
      `👤 ${removed}\n` +
      `📅 ${dayName}`
    );
  } catch (error) {
    console.error(
      "REMOVE ERROR:",
      error
    );

    await ctx.reply(
      "Ошибка удаления ❌\n\n" +
      String(error.message || error)
    );
  }
});


// ============================================================
// /AH — АРХИВ
// ============================================================

bot.command("ah", async ctx => {
  try {
    await showPidArchive(
      ctx,
      0,
      false
    );
  } catch (error) {
    console.error(
      "ARCHIVE ERROR:",
      error
    );

    await ctx.reply(
      "Ошибка загрузки архива ❌\n\n" +
      String(error.message || error)
    );
  }
});


// ============================================================
// КНОПКА АРХИВА
// ============================================================

bot.action(
  "pid_archive",
  async ctx => {
    try {
      await ctx.answerCbQuery();

      await showPidArchive(
        ctx,
        0,
        true
      );
    } catch (error) {
      console.error(
        "ARCHIVE BUTTON ERROR:",
        error
      );

      try {
        await ctx.reply(
          "Ошибка архива ❌\n\n" +
          String(error.message || error)
        );
      } catch { }
    }
  }
);


// ============================================================
// НАВИГАЦИЯ ПО АРХИВУ
// ============================================================

bot.action(
  /^pid_archive_(\d+)$/,
  async ctx => {
    try {
      await ctx.answerCbQuery();

      const index =
        Number(ctx.match[1]);

      await showPidArchive(
        ctx,
        index,
        true
      );
    } catch (error) {
      console.error(
        "ARCHIVE NAVIGATION ERROR:",
        error
      );

      try {
        await ctx.reply(
          "Ошибка переключения архива ❌\n\n" +
          String(error.message || error)
        );
      } catch { }
    }
  }
);


// ============================================================
// КНОПКА НАЗНАЧИТЬ
// ============================================================

bot.action(
  "pid_n",
  async ctx => {
    try {
      await ctx.answerCbQuery();

      if (!isAdmin(ctx)) {
        await ctx.reply(
          "Нет доступа ❌"
        );

        return;
      }

      await ctx.reply(
        "Чтобы назначить человека:\n\n" +
        "/n Имя\n\n" +
        "Или на определённый день:\n" +
        "/n пт Имя"
      );
    } catch (error) {
      console.error(
        "N BUTTON ERROR:",
        error
      );
    }
  }
);


// ============================================================
// КНОПКА УБРАТЬ
// ============================================================

bot.action(
  "pid_u",
  async ctx => {
    try {
      await ctx.answerCbQuery();

      if (!isAdmin(ctx)) {
        await ctx.reply(
          "Нет доступа ❌"
        );

        return;
      }

      await ctx.reply(
        "Чтобы убрать человека:\n\n" +
        "/u Имя\n\n" +
        "Или с определённого дня:\n" +
        "/u пт Имя"
      );
    } catch (error) {
      console.error(
        "U BUTTON ERROR:",
        error
      );
    }
  }
);


// ============================================================
// /NN — Х2 / Х3
// ============================================================

bot.command("nn", async ctx => {
  if (!isAdmin(ctx)) {
    await ctx.reply("Нет доступа ❌");
    return;
  }

  try {
    const args = ctx.message.text
      .trim()
      .split(/\s+/)
      .slice(1);

    if (args.length === 0) {
      await ctx.reply(
        "Использование:\n\n" +
        "/nn Имя\n" +
        "/nn пт Имя"
      );

      return;
    }

    let dayKey = getDayKey();
    let nameParts = args;

    const selectedDay =
      getDayByInput(args[0]);

    if (selectedDay) {
      dayKey = selectedDay.key;
      nameParts = args.slice(1);
    }

    const name =
      nameParts.join(" ").trim();

    if (!name) {
      await ctx.reply(
        "Укажи имя ❌"
      );

      return;
    }

    const state = await loadState();

    await ensureCurrentWeek(state);

    const people =
      state.currentWeek.days[dayKey] || [];

    const index = people.findIndex(
      person =>
        person
          .replace(
            /\s*х[23]\s*🔥?$/i,
            ""
          )
          .trim()
          .toLowerCase() ===
        name.toLowerCase()
    );

    if (index === -1) {
      await ctx.reply(
        `${name} ещё не назначен на этот день.\n` +
        `Сначала используй /n ${name}`
      );

      return;
    }

    const current = people[index];

    let multiplier = 1;

    if (/х3/i.test(current)) {
      multiplier = 3;
    } else if (/х2/i.test(current)) {
      multiplier = 2;
    }

    if (multiplier >= 3) {
      await ctx.reply(
        `🔥 ${name} уже имеет максимальное количество — х3`
      );

      return;
    }

    multiplier++;

    people[index] =
      `${name} х${multiplier} 🔥`;
    recordAssignmentHistory(state, "multiplier", name, dayKey, multiplier);
    debtAddOrUpdateAssignment(state, name, dayKey, multiplier, state.currentWeek.weekKey);

    state.currentWeek.days[dayKey] =
      people;

    await saveState(state);

    const dayName =
      DAYS.find(d => d.key === dayKey).name;

    await ctx.reply(
      `🔥 ${name} теперь х${multiplier}\n` +
      `📅 ${dayName}`
    );
  } catch (error) {
    console.error(
      "NN ERROR:",
      error
    );

    await ctx.reply(
      "Ошибка дополнительного назначения ❌\n\n" +
      String(error.message || error)
    );
  }
});


// /UU — снять X2/X3 и вернуть обычное назначение X1.
bot.command("uu", async ctx => {
  if (!isAdmin(ctx)) return ctx.reply("Нет доступа ❌");
  const args = String(ctx.message.text || "").trim().split(/\s+/).slice(1);
  if (!args.length) return ctx.reply("Использование: /uu Имя или /uu пт Имя");
  let dayKey = getDayKey(), nameParts = args;
  const selectedDay = getDayByInput(args[0]);
  if (selectedDay) { dayKey = selectedDay.key; nameParts = args.slice(1); }
  const name = nameParts.join(" ").trim();
  if (!name) return ctx.reply("Укажи имя ❌");
  const state = await loadState();
  await ensureCurrentWeek(state);
  const people = state.currentWeek.days[dayKey] || [];
  const index = people.findIndex(person => getAssignmentBaseName(person).toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"));
  if (index < 0 || getAssignmentMultiplier(people[index]) === 1) return ctx.reply("Этот пидор пока не X2");
  people[index] = getAssignmentBaseName(people[index]);
  state.currentWeek.days[dayKey] = people;
  recordAssignmentHistory(state, "multiplier_removed", name, dayKey, 1);
  debtAddOrUpdateAssignment(state, name, dayKey, 1, state.currentWeek.weekKey);
  await saveState(state);
  return ctx.reply("✅ Множитель снят. " + name + " снова X1.");
});

bot.hears(/^(диамант|золото)\s*([+-])\s*(.+)$/iu, async ctx => {
  if (!isAdmin(ctx)) return ctx.reply("Нет доступа ❌");
  const kind = ctx.match[1].toLocaleLowerCase("ru-RU") === "диамант" ? "diamond" : "gold";
  const sign = ctx.match[2], name = ctx.match[3].trim();
  if (!name) return ctx.reply("Укажи имя ❌");
  const state = await loadState();
  state.nameMarks = state.nameMarks || {};
  const key = getNameMarkKey(name), marks = state.nameMarks[key] || {};
  marks[kind] = sign === "+";
  if (!marks.diamond && !marks.gold) delete state.nameMarks[key];
  else state.nameMarks[key] = marks;
  await saveState(state);
  const label = kind === "diamond" ? "💎 Диамант" : "🥇 Золото";
  return ctx.reply((sign === "+" ? label + " отмечен: " : label + " снят: ") + name);
});


// ============================================================
// КОДЫ ВОРОТ
// ============================================================

bot.command("code", async ctx => {
  if (!isAdmin(ctx)) {
    await ctx.reply("Нет доступа ❌");
    return;
  }

  try {
    const args = ctx.message.text
      .trim()
      .split(/\s+/)
      .slice(1);

    if (args.length < 2) {
      await ctx.reply(
        "Использование:\n\n" +
        "/code Имя Код\n\n" +
        "Например:\n" +
        "/code Краснов 1234"
      );

      return;
    }

    const name = args[0];
    const code = args.slice(1).join(" ");

    const state = await loadState();

    state.codes[
      name.toLowerCase()
    ] = {
      name,
      code,
      updatedAt: Date.now()
    };

    await saveState(state);

    await ctx.reply(
      `✅ Код сохранён\n\n` +
      `👤 ${name}\n` +
      `🔑 ${code}`
    );
  } catch (error) {
    console.error(
      "CODE SAVE ERROR:",
      error
    );

    await ctx.reply(
      "Ошибка сохранения кода ❌\n\n" +
      String(error.message || error)
    );
  }
});


bot.command(
  "deletecode",
  async ctx => {
    if (!isAdmin(ctx)) {
      await ctx.reply(
        "Нет доступа ❌"
      );

      return;
    }

    try {
      const args =
        ctx.message.text
          .trim()
          .split(/\s+/)
          .slice(1);

      if (args.length === 0) {
        await ctx.reply(
          "Использование:\n/deletecode Имя"
        );

        return;
      }

      const name =
        args.join(" ").toLowerCase();

      const state =
        await loadState();

      if (!state.codes[name]) {
        await ctx.reply(
          "Такого кода нет ❌"
        );

        return;
      }

      delete state.codes[name];

      await saveState(state);

      await ctx.reply(
        "Код удалён ✅"
      );
    } catch (error) {
      console.error(
        "CODE DELETE ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка удаления кода ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


bot.command(
  "codes",
  async ctx => {
    if (!isAdmin(ctx)) {
      await ctx.reply(
        "Нет доступа ❌"
      );

      return;
    }

    try {
      const state =
        await loadState();

      const keys =
        Object.keys(
          state.codes || {}
        );

      if (keys.length === 0) {
        await ctx.reply(
          "Кодов пока нет"
        );

        return;
      }

      let text =
        "🔑 Сохранённые коды\n" +
        "━━━━━━━━━━━━━━\n\n";

      keys.forEach(key => {
        const item =
          state.codes[key];

        text +=
          `👤 ${item.name}\n` +
          `🔑 ${item.code}\n\n`;
      });

      await ctx.reply(text);
    } catch (error) {
      console.error(
        "CODES ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка загрузки кодов ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


bot.hears(
  /^код\s+(.+)$/i,
  async ctx => {
    try {
      const name =
        ctx.match[1]
          .trim()
          .toLowerCase();

      const state =
        await loadState();

      const item =
        state.codes[name];

      if (!item) {
        await ctx.reply(
          `Код для "${ctx.match[1].trim()}" не найден ❌`
        );

        return;
      }

      await ctx.reply(
        `👤 ${item.name}\n` +
        `🔑 ${item.code}`
      );
    } catch (error) {
      console.error(
        "CODE FIND ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка поиска кода ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


/* ============================================================
 * ☕ ЧАЕВЫЕ + РЕАКЦИИ И «КТО СЕГОДНЯ ПИДАР»
 *
 * ВСТАВИТЬ ПОСЛЕ ФУНКЦИЙ:
 * loadTipsState()
 * ensureTipsDay()
 * saveTipsState()
 * getTelegramDisplayName()
 *
 * И ДО СТАРЫХ ОБРАБОТЧИКОВ «ЧАЙ + СУММА» И «ПИДАР».
 * ============================================================ */


// ============================================================
// 🏆 ЛИДЕР СЕГОДНЯШНИХ ЧАЕВЫХ
// ============================================================

async function tipMemeGetTodayLeader() {
  const state = await loadTipsState();

  await ensureTipsDay(state);

  const entries = Object.values(state.today || {})
    .filter(item => item && Number(item.amount) > 0)
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  return entries[0]?.name || null;
}


// ============================================================
// 🗣 «ПИДАР», «КТО ПИДР» И ДРУГИЕ ФРАЗЫ
// ============================================================

bot.hears(
  /^\s*(?:кто\s+)?(пидар|пидарас|пидарасина|пидр)[!?.…]*\s*$/iu,
  async ctx => {
    try {
      const word = String(ctx.match[1]).toLowerCase();
      const leader = await tipMemeGetTodayLeader();

      const response = leader
        ? `Сегодня ${word} — ${leader}`
        : `Сегодня ${word} — пока никто не получил чаевых ☕`;

      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error("TIP MEME LEADER ERROR:", error);
    }
  }
);


// ============================================================
// 🎭 СТИКЕРЫ ЧАЕВЫХ — выбор по сумме конкретного начисления
// ============================================================
const TIP_STICKER_RANGES = [
[1,1,"CAACAgIAAxkBAAItE2r_cpjtrbdB-RY0C-HlHliEKvGeAALmmgACtdAoSxKhiKVCeq2oPQQ"],
[2,2,"CAACAgIAAxkBAAIr72rnxE1itmMV88hID589jvRkZopJAAKVAAOQZIYLxqakSnW74C49BA"],
[3,3,"CAACAgQAAxkBAAIr0mrmazvH6h6db2F0e1lCpzb5jqiMAAJnEAACFNeBUPE1247mBL8PPQQ"],
[4,4,"CAACAgIAAxkBAAIr1Grma2N4ZkWtMRSLIxmkw2mgPcUtAAIHAAOAPvIV5H90S092L889BA"],
[5,5,"CAACAgQAAxkBAAIr1mrma7Kx58OWdoXbyv1CE8OO_glnAAKnFAACkPwpUMKbDybjJckqPQQ"],
[6,6,"CAACAgIAAxkBAAIr2GrmbSMTz2_cwoi8psXjaDozuwABfQACoVoAAkqHqEqMypnnrdqUnT0E"],
[7,7,"CAACAgIAAxkBAAIr2mrmban0akn2tL65PTrdqqeK-EMfAAJZHAACBD0ISninedQLKx0ePQQ"],
[8,8,"CAACAgQAAxkBAAIr32rmcX9JsRt9DMygO9sVFzd0u4gUAAImFQACOFWpU-V6QhbRUzwiPQQ"],
[9,9,"CAACAgIAAxkBAAIr4WrmcbIvDz4ySBPK60cCmiwdpAEBAAIVAgACLGD1HOXzD7uWTW30PQQ"],
[10,10,"CAACAgIAAxkBAAIr42rmcpsjc59LcXXXg-eGbO66iRiVAAJhAQACLGD1HCMnhCIMjO3wPQQ"],
[11,15,"CAACAgIAAxkBAAIr5Wrm7Na2EEVYeusEn5i25KMLfQ3nAAIxZgAC0gThS_8fRUnfX3y5PQQ"],
[16,19,"CAACAgQAAxkBAAIr62rnxBC3B7-z4JujRdgDNLYiGIeHAALuEwACHEypUzesPey4sgEqPQQ"],
[20,20,"CAACAgIAAxkBAAIr7WrnxCmKLKh2rymWS9Y_ptH9pLZgAALUAAPlnj8XK3iXqAZigcQ9BA"],
[21,21,"CAACAgIAAxkBAAIr8WrnxIC9pbXEqx8hkyOHlwOO1XhHAAJBXAACuQrYS2dDOxEmlqvtPQQ"],
[22,26,"CAACAgQAAxkBAAIr82rnxK_8nSj_VnTZN4mGH6y2AkyXAALcFQACE3HxUbaiwwuBYGtXPQQ"],
[27,29,"CAACAgIAAxkBAAIr9WrnxPEehVxWndFuca9eSaAYJd5SAALyXgACKAHIS0Fty0W3oEwoPQQ"],
[30,30,"CAACAgIAAxkBAAIsJWrny5Jv4FYKKONwKSxBubYB1lb4AAIdAAMHsCEQhMwWticEkDA9BA"],
[31,36,"CAACAgIAAxkBAAIr92rnxTHY17DLpR8gZHFHE3WnpZncAAI2AAOcV8A0u-ZjVjnFW8Q9BA"],
[37,37,"CAACAgQAAxkBAAIr-WrnxVa_9kdDyn6ekHHH_0nmb1hPAAJBEAACLKlAUJN8TrilxB5kPQQ"],
[38,40,"CAACAgIAAxkBAAIr-2rnxZypdf2hwCi5rQtWuBwQIcqzAAIMAAOAPvIVrlWJv2ZYxOc9BA"],
[41,43,"CAACAgIAAxkBAAIr_WrnxcMNYMKizfujDfja84Wu6c_rAAKGAAOcV8A0l9sMnDPCN5A9BA"],
[44,46,"CAACAgIAAxkBAAIr_2rnxeBulta_zrjrgLFWG-cjLXOZAAKEAAOcV8A0Hes_5dP2xAQ9BA"],
[47,49,"CAACAgIAAxkBAAIsAWrnxg-mNi6wOhCzsvIY-8MiwP-OAAKOAAOcV8A0PGcvVIKMzlk9BA"],
[50,50,"CAACAgIAAxkBAAIsA2rnxi0LsNuqlJY4wkK7QfJzWvkKAAJ6AANIQhcVkUxvCvE2SYg9BA"],
[51,54,"CAACAgIAAxkBAAIsBWrnxkrHOOhw3jPDSC980z7fOJP1AAJDAAOcV8A01g6lY6CUgMI9BA"],
[55,58,"CAACAgIAAxkBAAIsB2rnxm9CuSfshTYWsFWDMgMoeqvlAAJQAAOcV8A0HHLjtbLtrco9BA"],
[59,66,"CAACAgIAAxkBAAIsCWrnxtzdZ9xkxjM1GU1RwNhkjMX8AAIqGQACYvEAAUpncy5sB-Pfwj0E"],
[67,67,"CAACAgIAAxkBAAIsDWrnx1w2OKYjmXHLN6SPnb4H_FwRAAJfewACzB4QSV6WhTABdDCBPQQ"],
[68,68,"CAACAgIAAxkBAAIsC2rnxymjVSaSEVAFe6ozcKYx3LnlAAJvAAOAAAGnEaLFNZToHb8nPQQ"],
[69,69,"CAACAgIAAxkBAAIsD2rnx3NRMV_p4xMjonUKdCSruGv7AAKtTgACn5MRSjAlpjTadUbqPQQ"],
[70,73,"CAACAgIAAxkBAAIsEWrnx6f5ERRdM4JUaCYgvpA-8za1AAItAAMHsCEQ1VCDsRebZpI9BA"],
[74,76,"CAACAgIAAxkBAAIsFWrnyd_dFgAB6JkDtK2dSUPJgkzDDQACqGQAAulWeEmugXYXRewR1j0E"],
[77,77,"CAACAgIAAxkBAAIsE2rnx8zNjaFRwLZqN8Jlr5FRK2BnAAJ5jQACQuWYSFHeSXS_HTPfPQQ"],
[78,81,"CAACAgIAAxkBAAIsF2rnygTa9IX3vZ2ogO_warHP9d8DAAKHAAPww8AOEMoKuL2QI4Y9BA"],
[82,84,"CAACAgIAAxkBAAIsI2rny1KTWZlXE36vXUsyw4HAA1EwAALQOgACdhxxS4t_1I79WEC3PQQ"],
[85,89,"CAACAgIAAxkBAAIsJ2rny5c_Hz3BfsNuTUbOHS-twl-NAAIcAAMHsCEQbZ9FU7Fg1Aw9BA"],
[90,93,"CAACAgIAAxkBAAIsIWrnyyfq4pJJ1slgNQABepJTeFvx3AACJgEAAgFcygl8FyQ1L2HsSz0E"],
[94,97,"CAACAgIAAxkBAAIsGWrnyld93Iy7JV11q7MlBpW4_JihAAKkOQACqeRxSxBqKfWfUpCfPQQ"],
[98,99,"CAACAgIAAxkBAAIsHWrnytN4qMDZk6tqc4RGUJpfegEoAAKAAAOcV8A0DeRC9aeg01Q9BA"],
[100,100,"CAACAgIAAxkBAAIsKWrny_mnXizCPMlJ8ZkZcJd0HNW1AALLFAACB-yZSaoLHHPxfN9kPQQ"]
];
const TIP_STICKERS_OVER_100 = [
  "CAACAgIAAxkBAAIsG2rnynHijSH87xLVcX5hfOb3weguAAKjAAPww8AOxkl6S_6sZLA9BA",
  "CAACAgIAAxkBAAIsK2rnzBsF9afJESW3ILiatU88Wz3-AAIjbQACRjiISl_-j6h0uIzrPQQ",
  "CAACAgIAAxkBAAItFWr_cuUY8EtHf3Zlqu5ximo-VWoKAAKFsQACY8s5Sv5cXSQRrdpoPQQ"
];
function tipMemeGetReaction(amount) {
  if (!Number.isInteger(amount) || amount <= 0) return null;
  if (amount > 100) {
    const roll = Math.random();
    const index = roll < 0.01 ? 2 : (roll < 0.505 ? 0 : 1);
    return { type: "sticker", value: TIP_STICKERS_OVER_100[index] };
  }
  const found = TIP_STICKER_RANGES.find(([min, max]) => amount >= min && amount <= max);
  return found ? { type: "sticker", value: found[2] } : null;
}


// ============================================================
// ☕ ЧАЙ + СУММА
//
// Этот обработчик также сохраняет чаевые в старую статистику.
// Он заменяет старый обработчик для совпадающих сообщений,
// поэтому сумма не будет записываться дважды.
// ============================================================

bot.hears(
  /^\s*чай\s*\+?\s*(\d+)\s*$/i,
  async ctx => {
    try {
      const amount = Number(
        String(ctx.match[1]).replace(",", ".")
      );

      if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
        await ctx.reply("Сумма чаевых должна быть целым числом больше 0 грн. ❌");
        return;
      }

      const state = await loadTipsState();

      await ensureTipsDay(state);

      if (!state.today) {
        state.today = {};
      }

      const userId = String(ctx.from.id);
      const name = getTelegramDisplayName(ctx);

      if (!state.today[userId]) {
        state.today[userId] = {
          name,
          amount: 0
        };
      }

      const item = state.today[userId];

      item.name = name;
      item.amount =
        (Number(item.amount) || 0) + amount;

      await saveTipsState(state);
      await v3AddRecord({
        userId, name, type: "tea", amount,
        dateKey: v3DateISO(finalEarningsToday()),
        createdBy: userId
      });

      // Сохраняем прежнее подтверждение добавления чаевых.
      await ctx.reply(
        `☕ ${name} +${amount} грн\n` +
        `💰 Всего сегодня: ${item.amount} грн`
      );

      // Дополнительная реакция — ответ именно на исходное сообщение.
      const reaction = tipMemeGetReaction(amount);

      if (!reaction) {
        return;
      }

      const replyOptions = {
        reply_to_message_id: ctx.message.message_id
      };

      if (reaction.type === "sticker") {
        await ctx.replyWithSticker(
          reaction.value,
          replyOptions
        );
      } else {
        await ctx.reply(
          reaction.value,
          replyOptions
        );
      }
    } catch (error) {
      console.error("TIP MEME REACTION ERROR:", error);

      await ctx.reply(
        "❌ Не удалось обработать чаевые."
      );
    }
  }
);


// ============================================================
// КОНЕЦ БЛОКА «ЧАЕВЫЕ + РЕАКЦИИ»
// ============================================================
// ============================================================
// ☕ ЧАЕВЫЕ
// ============================================================

const TIPS_COLLECTION =
  "courier-tips-v1";

const TIPS_KEY = "main";


// ============================================================
// ИМЯ TELEGRAM
// ============================================================

function getTelegramDisplayName(ctx) {
  const user = ctx.from;

  if (!user) {
    return "Неизвестный";
  }

  let name = "";

  if (user.first_name) {
    name += user.first_name;
  }

  if (user.last_name) {
    name += " " + user.last_name;
  }

  name = name.trim();

  if (!name) {
    name =
      user.username ||
      "Неизвестный";
  }

  return name;
}


// ============================================================
// ДАТА ЧАЕВЫХ
// ============================================================

function getTipsDateKey() {
  const now = new Date();

  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(now);
}


function getTipsWeekKeyFromDateKey(
  dateKey
) {
  const parts =
    String(dateKey)
      .split("-")
      .map(Number);

  if (
    parts.length !== 3 ||
    parts.some(
      v => !Number.isFinite(v)
    )
  ) {
    return dateKey;
  }

  const date =
    new Date(
      Date.UTC(
        parts[0],
        parts[1] - 1,
        parts[2]
      )
    );

  const day =
    date.getUTCDay();

  const diff =
    day === 0
      ? -6
      : 1 - day;

  date.setUTCDate(
    date.getUTCDate() + diff
  );

  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0"),
    String(
      date.getUTCDate()
    ).padStart(2, "0")
  ].join("-");
}


function getTipsMonthKey(dateKey) {
  return String(dateKey).slice(0, 7);
}


function getCurrentWeekKeyForTips() {
  return getTipsWeekKeyFromDateKey(
    getTipsDateKey()
  );
}


// ============================================================
// БАЗА ЧАЕВЫХ
// ============================================================

async function loadTipsState() {
  const collection =
    db.collection(
      TIPS_COLLECTION
    );

  const doc =
    await collection.findOne({
      key: TIPS_KEY
    });

  if (!doc || !doc.data) {
    const state = {
      currentDate:
        getTipsDateKey(),

      today: {},

      // Старый архив сохраняем!
      archive: [],

      // Новый недельный архив.
      weeklyArchive: []
    };

    await collection.updateOne(
      {
        key: TIPS_KEY
      },
      {
        $set: {
          key: TIPS_KEY,
          data: state,
          updatedAt: Date.now()
        }
      },
      {
        upsert: true
      }
    );

    return state;
  }

  const state = doc.data;

  if (!state.currentDate) {
    state.currentDate =
      getTipsDateKey();
  }

  if (!state.today) {
    state.today = {};
  }

  if (!state.archive) {
    state.archive = [];
  }

  if (!state.weeklyArchive) {
    state.weeklyArchive = [];
  }

  // Миграция старого дневного
  // архива в недельный.
  ensureWeeklyTipsArchiveMigration(
    state
  );

  return state;
}


async function saveTipsState(state) {
  const collection =
    db.collection(
      TIPS_COLLECTION
    );

  await collection.updateOne(
    {
      key: TIPS_KEY
    },
    {
      $set: {
        key: TIPS_KEY,
        data: state,
        updatedAt: Date.now()
      }
    },
    {
      upsert: true
    }
  );
}


// ============================================================
// СОЗДАНИЕ НЕДЕЛЬНОГО АРХИВА ИЗ СТАРЫХ ДНЕЙ
// ============================================================

function buildWeeklyEntryFromDailyArchive(
  state,
  weekKey
) {
  const totals = {};

  for (
    const day of state.archive || []
  ) {
    if (!day || !day.date) {
      continue;
    }

    if (
      getTipsWeekKeyFromDateKey(
        day.date
      ) !== weekKey
    ) {
      continue;
    }

    for (
      const [
        userId,
        item
      ] of Object.entries(
        day.tips || {}
      )
    ) {
      if (!item) continue;

      if (!totals[userId]) {
        totals[userId] = {
          name:
            item.name ||
            "Неизвестный",
          amount: 0
        };
      }

      totals[userId].name =
        item.name ||
        totals[userId].name;

      totals[userId].amount +=
        Number(item.amount) || 0;
    }
  }

  return {
    weekKey,
    tips: totals
  };
}


function ensureWeeklyTipsArchiveMigration(
  state
) {
  if (!state.weeklyArchive) {
    state.weeklyArchive = [];
  }

  const existing =
    new Set(
      state.weeklyArchive
        .filter(
          w =>
            w &&
            w.weekKey
        )
        .map(
          w => w.weekKey
        )
    );

  const weekKeys =
    [
      ...new Set(
        (state.archive || [])
          .filter(
            d =>
              d &&
              d.date
          )
          .map(
            d =>
              getTipsWeekKeyFromDateKey(
                d.date
              )
          )
      )
    ];

  let changed = false;

  for (
    const weekKey of weekKeys
  ) {
    if (
      existing.has(weekKey)
    ) {
      continue;
    }

    state.weeklyArchive.push(
      buildWeeklyEntryFromDailyArchive(
        state,
        weekKey
      )
    );

    existing.add(
      weekKey
    );

    changed = true;
  }

  if (changed) {
    state.weeklyArchive.sort(
      (a, b) =>
        String(b.weekKey)
          .localeCompare(
            String(a.weekKey)
          )
    );
  }

  return changed;
}


// ============================================================
// ОБНОВЛЕНИЕ НЕДЕЛЬНОГО АРХИВА
// ============================================================

function rebuildWeeklyArchiveEntry(
  state,
  weekKey
) {
  const fresh =
    buildWeeklyEntryFromDailyArchive(
      state,
      weekKey
    );

  const index =
    state.weeklyArchive.findIndex(
      w =>
        w.weekKey ===
        weekKey
    );

  if (index === -1) {
    state.weeklyArchive.unshift(
      fresh
    );
  } else {
    state.weeklyArchive[index] =
      fresh;
  }
}


// ============================================================
// ПЕРЕХОД НА НОВЫЙ ДЕНЬ
// ============================================================

async function ensureTipsDay(state) {
  const today =
    getTipsDateKey();

  if (
    state.currentDate ===
    today
  ) {
    return false;
  }

  const oldDate =
    state.currentDate;

  const oldWeekKey =
    getTipsWeekKeyFromDateKey(
      oldDate
    );

  const newWeekKey =
    getTipsWeekKeyFromDateKey(
      today
    );

  // Старый день сохраняем.
  if (
    Object.keys(
      state.today || {}
    ).length > 0
  ) {
    state.archive.unshift({
      date:
        state.currentDate,

      tips:
        state.today
    });
  }

  // Если началась новая неделя —
  // создаём итог предыдущей недели.
  if (
    oldWeekKey !==
    newWeekKey
  ) {
    rebuildWeeklyArchiveEntry(
      state,
      oldWeekKey
    );
  }

  state.currentDate =
    today;

  state.today = {};

  // Старый дневной архив НЕ удаляем.
  // Это важно для "Чай все".

  // Недельный архив ограничиваем
  // двадцатью неделями.
  if (
    state.weeklyArchive.length >
    20
  ) {
    state.weeklyArchive =
      state.weeklyArchive.slice(
        0,
        20
      );
  }

  await saveTipsState(
    state
  );

  return true;
}


// ============================================================
// ТАБЛИЦА ЧАЕВЫХ ЗА СЕГОДНЯ
// ============================================================

function buildTipsTable(state) {
  const entries =
    Object.values(
      state.today || {}
    );

  entries.sort(
    (a, b) =>
      b.amount - a.amount
  );

  let text =
    "☕ ЧАЕВЫЕ ЗА СЕГОДНЯ\n";

  text +=
    "━━━━━━━━━━━━━━\n\n";

  if (
    entries.length === 0
  ) {
    return (
      text +
      "Пока чаевых нет 😢"
    );
  }

  entries.forEach(
    (item, index) => {
      text +=
        `${index + 1}. ` +
        `${item.name} — ` +
        `${item.amount} грн\n`;
    }
  );

  text +=
    "\n━━━━━━━━━━━━━━";

  return text;
}


function tipsKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "📦 Архив чаевых",
          callback_data:
            "tips_archive"
        }
      ]
    ]
  };
}


// ============================================================
// ПОКАЗ ЧАЕВЫХ
// ============================================================

async function showTips(ctx) {
  try {
    const state =
      await loadTipsState();

    await ensureTipsDay(
      state
    );

    await ctx.reply(
      buildTipsTable(state),
      {
        reply_markup:
          tipsKeyboard()
      }
    );
  } catch (error) {
    console.error(
      "TIPS TABLE ERROR:",
      error
    );

    await ctx.reply(
      "Ошибка загрузки чаевых ❌\n\n" +
      String(error.message || error)
    );
  }
}


// ============================================================
// ИСТОРИЧЕСКИЕ ЧАЕВЫЕ И ПАКЕТНЫЙ ВВОД
// Формат: чай 20.10.2026 100
// Несколько строк можно отправить одним сообщением.
// ============================================================

bot.hears(
  /^чай\s+\d{2}[./]\d{2}[./]\d{4}\s+\d+(?:[.,]\d+)?(?:\r?\nчай\s+\d{2}[./]\d{2}[./]\d{4}\s+\d+(?:[.,]\d+)?)*$/i,
  async ctx => {
    try {
      const lines = String(ctx.message.text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const parsed = [];
      const errors = [];
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^чай\s+(\d{2}[./]\d{2}[./]\d{4})\s+(\d+(?:[.,]\d+)?)$/i);
        if (!m) { errors.push("Строка " + (i + 1) + ": неверный формат"); continue; }
        const amount = Number(m[2].replace(",", "."));
        if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) {
          errors.push("Строка " + (i + 1) + ": сумма должна быть целым числом от 1 до 100000");
          continue;
        }
        const date = finalEarningsParseDate(m[1]);
        if (!date) { errors.push("Строка " + (i + 1) + ": неверная дата"); continue; }
        parsed.push({ dateKey: getTipsDateKeyFromInput(m[1]), amount, shownDate: m[1] });
      }
      if (!parsed.length) {
        await ctx.reply("❌ Формат: чай 20.10.2026 100\nМожно несколько строк за разные дни.");
        return;
      }
      const state = await loadTipsState();
      await ensureTipsDay(state);
      const userId = String(ctx.from.id);
      const name = getTelegramDisplayName(ctx);
      for (const row of parsed) {
        if (row.dateKey === state.currentDate) {
          if (!state.today[userId]) state.today[userId] = { name, amount: 0 };
          state.today[userId].name = name;
          state.today[userId].amount = (Number(state.today[userId].amount) || 0) + row.amount;
        } else {
          let day = (state.archive || []).find(d => d && d.date === row.dateKey);
          if (!day) {
            day = { date: row.dateKey, tips: {} };
            state.archive = state.archive || [];
            state.archive.push(day);
          }
          day.tips = day.tips || {};
          if (!day.tips[userId]) day.tips[userId] = { name, amount: 0 };
          day.tips[userId].name = name;
          day.tips[userId].amount = (Number(day.tips[userId].amount) || 0) + row.amount;
          rebuildWeeklyArchiveEntry(state, getTipsWeekKeyFromDateKey(row.dateKey));
        }
      }
      state.archive.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      await saveTipsState(state);
      await ctx.reply("✅ Чаевые добавлены за " + parsed.length + " день(дней):\n" +
        parsed.map(x => x.shownDate + " — +" + x.amount + " грн").join("\n") +
        (errors.length ? "\n\n⚠️ Пропущено:\n" + errors.join("\n") : ""));
    } catch (error) {
      console.error("HISTORICAL TIPS ERROR:", error);
      await ctx.reply("❌ Ошибка записи исторических чаевых.");
    }
  }
);

function getTipsDateKeyFromInput(input) {
  const parsed = finalEarningsParseDate(input);
  if (!parsed) return null;
  return [
    parsed.getUTCFullYear(),
    String(parsed.getUTCMonth() + 1).padStart(2, "0"),
    String(parsed.getUTCDate()).padStart(2, "0")
  ].join("-");
}

// Дублирующий обработчик «Чай + сумма» удалён: начисление выполняет единый обработчик выше.


// ============================================================
// /TIPS
// ============================================================

bot.command(
  "tips",
  async ctx => {
    await showTips(ctx);
  }
);


// ============================================================
// ПОДСЧЁТ ЧАЕВЫХ ПО ПЕРИОДУ
// ============================================================

function getTipsTotals(
  state,
  filterFn
) {
  const totals = {};

  function addEntries(
    entries
  ) {
    for (
      const [
        userId,
        item
      ] of Object.entries(
        entries || {}
      )
    ) {
      if (!item) continue;

      if (!totals[userId]) {
        totals[userId] = {
          name:
            item.name ||
            "Неизвестный",
          amount: 0
        };
      }

      totals[userId].name =
        item.name ||
        totals[userId].name;

      totals[userId].amount +=
        Number(item.amount) || 0;
    }
  }

  for (
    const day of state.archive || []
  ) {
    if (!day || !day.date) {
      continue;
    }

    if (
      filterFn(day.date)
    ) {
      addEntries(
        day.tips
      );
    }
  }

  // Сегодня
  if (
    filterFn(
      state.currentDate
    )
  ) {
    addEntries(
      state.today
    );
  }

  return totals;
}


function getTipsUserTotal(
  state,
  userId,
  filterFn
) {
  const totals =
    getTipsTotals(
      state,
      filterFn
    );

  return (
    totals[String(userId)]
      ?.amount || 0
  );
}


function buildPeriodText(
  title,
  total
) {
  return (
    `☕ ${title}\n` +
    `━━━━━━━━━━━━━━\n\n` +
    `💰 ${total} грн`
  );
}


// ============================================================
// ЧАЙ НЕДЕЛЯ / МЕСЯЦ / ВСЕ
// ============================================================

bot.hears(
  /^чай\s+(неделя|месяц|все)$/i,
  async ctx => {
    try {
      const period =
        ctx.match[1]
          .toLowerCase();

      const state =
        await loadTipsState();

      await ensureTipsDay(
        state
      );

      const userId =
        String(ctx.from.id);

      let total = 0;
      let title = "";

      if (
        period === "неделя"
      ) {
        const weekKey =
          getCurrentWeekKeyForTips();

        total =
          getTipsUserTotal(
            state,
            userId,
            dateKey =>
              getTipsWeekKeyFromDateKey(
                dateKey
              ) === weekKey
          );

        title =
          "ТВОИ ЧАЕВЫЕ ЗА НЕДЕЛЮ";
      }

      if (
        period === "месяц"
      ) {
        const monthKey =
          getTipsMonthKey(
            getTipsDateKey()
          );

        total =
          getTipsUserTotal(
            state,
            userId,
            dateKey =>
              getTipsMonthKey(
                dateKey
              ) === monthKey
          );

        title =
          "ТВОИ ЧАЕВЫЕ ЗА МЕСЯЦ";
      }

      if (
        period === "все"
      ) {
        total =
          getTipsUserTotal(
            state,
            userId,
            () => true
          );

        title =
          "ТВОИ ЧАЕВЫЕ ЗА ВСЁ ВРЕМЯ";
      }

      await ctx.reply(
        buildPeriodText(
          title,
          total
        )
      );
    } catch (error) {
      console.error(
        "TIPS PERIOD ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка подсчёта чаевых ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


// ============================================================
// НЕДЕЛЬНЫЙ АРХИВ ЧАЕВЫХ
// ============================================================

function buildWeeklyTipsArchiveText(
  state
) {
  ensureWeeklyTipsArchiveMigration(
    state
  );

  const weeks =
    [...(
      state.weeklyArchive || []
    )];

  if (
    weeks.length === 0
  ) {
    return (
      "📦 АРХИВ ЧАЕВЫХ\n" +
      "━━━━━━━━━━━━━━\n\n" +
      "Архив пока пуст."
    );
  }

  let text =
    "📦 АРХИВ ЧАЕВЫХ — ПО НЕДЕЛЯМ\n";

  text +=
    "━━━━━━━━━━━━━━\n\n";

  for (
    const week of weeks
  ) {
    const entries =
      Object.values(
        week.tips || {}
      );

    entries.sort(
      (a, b) =>
        b.amount - a.amount
    );

    text +=
      `📅 Неделя от ${formatDate(
        new Date(
          week.weekKey
        )
      )}\n`;

    if (
      entries.length === 0
    ) {
      text +=
        "Нет данных\n\n";

      continue;
    }

    let weekTotal = 0;

    entries.forEach(
      (item, index) => {
        const amount =
          Number(item.amount) ||
          0;

        weekTotal +=
          amount;

        text +=
          `${index + 1}. ` +
          `${item.name} — ` +
          `${amount} грн\n`;
      }
    );

    text +=
      `💰 Всего за неделю: ${weekTotal} грн\n\n`;
  }

  text +=
    "━━━━━━━━━━━━━━";

  return text.trim();
}


// ============================================================
// /AHC
// ============================================================

bot.command(
  "ahc",
  async ctx => {
    try {
      const state =
        await loadTipsState();

      await ensureTipsDay(
        state
      );

      await ctx.reply(
        buildWeeklyTipsArchiveText(
          state
        )
      );
    } catch (error) {
      console.error(
        "TIPS ARCHIVE ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка загрузки архива чаевых ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


// ============================================================
// КНОПКА АРХИВА ЧАЕВЫХ
// ============================================================

bot.action(
  "tips_archive",
  async ctx => {
    try {
      await ctx.answerCbQuery();

      const state =
        await loadTipsState();

      await ensureTipsDay(
        state
      );

      const text =
        buildWeeklyTipsArchiveText(
          state
        );

      try {
        await ctx.editMessageText(
          text
        );
      } catch {
        await ctx.reply(
          text
        );
      }
    } catch (error) {
      console.error(
        "TIPS ARCHIVE BUTTON ERROR:",
        error
      );

      try {
        await ctx.reply(
          "Ошибка архива чаевых ❌\n\n" +
          String(error.message || error)
        );
      } catch { }
    }
  }
);


// ============================================================
// ЧАЕВЫЕ ПО ФРАЗАМ
// ============================================================

bot.hears(
  /^(топ чай|чаевые)$/i,
  async ctx => {
    await showTips(ctx);
  }
);


// ============================================================
// АДМИН: ЧАЙ ИМЯ +50 / -50
// ============================================================

bot.hears(
  /^чай\s+(.+?)\s*([+-])\s*(\d+(?:[.,]\d+)?)$/i,
  async ctx => {
    try {
      if (!isAdmin(ctx)) {
        await ctx.reply(
          "Нет доступа ❌"
        );

        return;
      }

      const name =
        ctx.match[1].trim();

      const sign =
        ctx.match[2];

      const amount =
        Number(
          ctx.match[3]
            .replace(",", ".")
        );

      if (
        !Number.isFinite(amount) ||
        !Number.isInteger(amount) ||
        amount <= 0
      ) {
        await ctx.reply(
          "Сумма чаевых должна быть целым числом больше 0 ❌"
        );

        return;
      }

      const state =
        await loadTipsState();

      await ensureTipsDay(
        state
      );

      const userId =
        Object.keys(
          state.today
        ).find(id =>
          String(
            state.today[id].name
          ).toLowerCase() ===
          name.toLowerCase()
        );

      if (!userId) {
        await ctx.reply(
          `❌ ${name} сегодня ещё не записан в чаевых.`
        );

        return;
      }

      if (
        sign === "+"
      ) {
        state.today[userId]
          .amount += amount;
      } else {
        state.today[userId]
          .amount -= amount;

        if (
          state.today[userId]
            .amount < 0
        ) {
          state.today[userId]
            .amount = 0;
        }
      }

      await saveTipsState(
        state
      );

      const total =
        state.today[userId]
          .amount;

      await ctx.reply(
        `☕ ${name} ${sign}${amount} грн\n` +
        `💰 Теперь всего: ${total} грн`
      );
    } catch (error) {
      console.error(
        "ADMIN TIPS ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка изменения чаевых ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


// ============================================================
// БАНКА / СЕРЁГА / ПРИВЕТ И ПРОЧИЕ ФРАЗЫ
// ============================================================

bot.hears(
  /^банка$/i,
  async ctx => {
    await ctx.reply(
      "Кидай сюда пидар",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🏦 Открыть банку",
                url:
                  "https://send.monobank.ua/jar/6vVGZRPKVE"
              }
            ]
          ]
        }
      }
    );
  }
);


bot.hears(
  /^(серега|сергей|серый|Серёга)$/i,
  async ctx => {
    await ctx.reply(
      "Серега, иди нахуй 😂"
    );
  }
);


bot.hears(
  /^пидар$/i,
  async ctx => {
    await ctx.reply(
      "Серёга"
    );
  }
);


bot.hears(
  /^педик$/i,
  async ctx => {
    await ctx.reply(
      "Саня"
    );
  }
);


bot.hears(
  /^привет$/i,
  async ctx => {
    const phrases = [
      "Глобовец на смене",
      "Глобовец катает"
    ];

    const emojis = [
      "😎",
      "🚴",
      "🔥",
      "😂",
      "🫡",
      "💪",
      "😏",
      "🚀"
    ];

    const phrase =
      phrases[
      Math.floor(
        Math.random() *
        phrases.length
      )
      ];

    const emoji =
      emojis[
      Math.floor(
        Math.random() *
        emojis.length
      )
      ];

    await ctx.reply(
      `${phrase} ${emoji}`
    );
  }
);


// ============================================================
// КВЕСТ
// ============================================================

const QUEST_DB_COLLECTION =
  "courier-quest-settings";

const QUEST_DB_KEY = "main";

const DEFAULT_QUEST = [
  {
    orders: 81,
    reward: 1400
  },
  {
    orders: 115,
    reward: 2200
  },
  {
    orders: 137,
    reward: 2800
  },
  {
    orders: 171,
    reward: 3600
  }
];


// ============================================================
// ЗАГРУЗКА КВЕСТА
// ============================================================

async function loadQuest() {
  const collection =
    db.collection(
      QUEST_DB_COLLECTION
    );

  const doc =
    await collection.findOne({
      key: QUEST_DB_KEY
    });

  if (!doc || !doc.data) {
    await collection.updateOne(
      {
        key: QUEST_DB_KEY
      },
      {
        $set: {
          key: QUEST_DB_KEY,
          data: DEFAULT_QUEST,
          updatedAt: Date.now()
        }
      },
      {
        upsert: true
      }
    );

    return DEFAULT_QUEST;
  }

  return doc.data;
}


// ============================================================
// СОХРАНЕНИЕ КВЕСТА
// ============================================================

async function saveQuest(
  quest
) {
  const collection =
    db.collection(
      QUEST_DB_COLLECTION
    );

  await collection.updateOne(
    {
      key: QUEST_DB_KEY
    },
    {
      $set: {
        key: QUEST_DB_KEY,
        data: quest,
        updatedAt: Date.now()
      }
    },
    {
      upsert: true
    }
  );
}


// ============================================================
// /QN
// ============================================================
//
// Пример:
//
// /qn 81 1400 115 2200 137 2800 171 3600
//
// ============================================================

bot.command(
  "qn",
  async ctx => {
    if (!isAdmin(ctx)) {
      await ctx.reply(
        "Нет доступа ❌"
      );

      return;
    }

    try {
      const args =
        ctx.message.text
          .trim()
          .split(/\s+/)
          .slice(1);

      if (
        args.length !== 8
      ) {
        await ctx.reply(
          "❌ Неверный формат\n\n" +

          "Использование:\n" +

          "/qn 81 1400 115 2200 137 2800 171 3600\n\n" +

          "Формат:\n" +
          "количество заказов → вознаграждение"
        );

        return;
      }

      const numbers =
        args.map(Number);

      if (
        numbers.some(
          value =>
            !Number.isFinite(value) ||
            value < 0
        )
      ) {
        await ctx.reply(
          "❌ Все значения должны быть числами."
        );

        return;
      }

      const quest = [
        {
          orders: numbers[0],
          reward: numbers[1]
        },
        {
          orders: numbers[2],
          reward: numbers[3]
        },
        {
          orders: numbers[4],
          reward: numbers[5]
        },
        {
          orders: numbers[6],
          reward: numbers[7]
        }
      ];

      await saveQuest(
        quest
      );

      await ctx.reply(
        "✅ Квест обновлён!\n\n" +

        `📦 ${quest[0].orders} заказов — 💰 ${quest[0].reward} ₴\n` +
        `📦 ${quest[1].orders} заказов — 💰 ${quest[1].reward} ₴\n` +
        `📦 ${quest[2].orders} заказов — 💰 ${quest[2].reward} ₴\n` +
        `📦 ${quest[3].orders} заказов — 💰 ${quest[3].reward} ₴`
      );
    } catch (error) {
      console.error(
        "QUEST UPDATE ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка изменения квеста ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


// ============================================================
// ПОКАЗ КВЕСТА
// ============================================================

async function sendQuest(
  ctx
) {
  try {
    const quest =
      await loadQuest();

    let text =
      "🎯 <b>КВЕСТ</b>\n" +
      "━━━━━━━━━━━━━━\n\n" +

      "📦 <b>Заказы</b> — 💰 <b>Вознаграждение</b>\n\n";

    quest.forEach(
      item => {
        text +=
          `📦 <b>${item.orders}</b> заказов — 💰 <b>${item.reward} ₴</b>\n`;
      }
    );

    text +=
      "\n━━━━━━━━━━━━━━\n" +
      "🔥 Выполняй заказы и получай дополнительное вознаграждение!";

    await ctx.reply(
      text,
      {
        parse_mode: "HTML"
      }
    );
  } catch (error) {
    console.error(
      "QUEST DISPLAY ERROR:",
      error
    );

    await ctx.reply(
      "Ошибка загрузки квеста ❌\n\n" +
      String(error.message || error)
    );
  }
}


bot.hears(
  /^квест$/i,
  async ctx => {
    await sendQuest(ctx);
  }
);


// ============================================================
// HELP
// ============================================================

bot.command(
  "help",
  async ctx => {
    await ctx.reply(
      "📋 Команды бота\n\n" +

      "ТАБЛИЦА:\n" +
      "/p — показать таблицу\n" +
      "ПИДАРАСЫ — показать таблицу\n" +
      "/n Имя — назначить сегодня\n" +
      "/n пт Имя — назначить на пятницу\n" +
      "/nn Имя — сделать х2/х3\n" +
      "/uu Имя — снять х2/х3, вернуть х1\n" +
      "Диамант + Имя / Диамант - Имя — отметка 💎\n" +
      "Золото + Имя / Золото - Имя — отметка 🥇\n" +
      "/u Имя — убрать сегодня\n" +
      "/u пт Имя — убрать с пятницы\n" +
      "/ah — архив таблицы\n\n" +

      "ЧАЕВЫЕ:\n" +
      "/tips — чаевые за сегодня\n" +
      "Чай 10 или Чай +10 — добавить себе 10 грн\n" +
      "Чай неделя — твои чаевые за текущую неделю\n" +
      "Чай месяц — твои чаевые за текущий месяц\n" +
      "Чай все — твои чаевые за всё время\n" +
      "/ahc — архив чаевых по неделям\n\n" +

      "КОДЫ:\n" +
      "/code Имя Код — сохранить код\n" +
      "Код Имя — найти код\n" +
      "/deletecode Имя — удалить код\n" +
      "/codes — список кодов\n\n" +

      "КВЕСТ:\n" +
      "квест — показать квест\n" +
      "/qn — изменить квест"
    );
  }
);


// ============================================================
// ОБРАБОТКА ОШИБОК
// ============================================================

bot.catch(
  async (error, ctx) => {
    console.error(
      "BOT ERROR:",
      error
    );

    try {
      await ctx.reply(
        "Произошла ошибка ❌\n\n" +
        String(
          error.message ||
          error
        )
      );
    } catch (
    replyError
    ) {
      console.error(
        "ERROR SENDING ERROR MESSAGE:",
        replyError
      );
    }
  }
);
// ============================================================
// ПОДДЕРЖКА АВТОРА БОТА
// ============================================================
//
// Автоматически отправляет сообщение:
// 11:00 и 18:00 по времени Europe/Kyiv
//
// Также вызывается словом:
// поддержка
//
// Кнопка ведёт на Monobank-банку автора.
//
// ============================================================

const SUPPORT_COLLECTION = "courier-bot-support-v1";
const SUPPORT_KEY = "main";

const SUPPORT_JAR_URL =
  "https://send.monobank.ua/jar/LojUrYF86";

const SUPPORT_TEXT =
  "🛠 Каждое обновление бота — это часы работы, проверки и исправления ошибок.\n\n" +
  "Иногда за одной новой функцией стоят долгие поиски решения и непростые доработки.\n\n" +
  "Если хочешь поддержать развитие бота и помочь выпускать новые обновления — буду благодарен за донат ❤️\n\n" +
  "Даже небольшая поддержка очень мотивирует двигаться дальше! 🙏";


// ------------------------------------------------------------
// КНОПКА ПОДДЕРЖКИ
// ------------------------------------------------------------

function supportKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "💰 Поддержать автора",
          url: SUPPORT_JAR_URL
        }
      ]
    ]
  };
}


// ------------------------------------------------------------
// ОТПРАВКА ПОДДЕРЖКИ
// ------------------------------------------------------------

async function sendSupport(ctx) {

  try {

    await ctx.reply(SUPPORT_TEXT, {
      parse_mode: "HTML",
      reply_markup: supportKeyboard()
    });

  } catch (error) {

    console.error(
      "SUPPORT MESSAGE ERROR:",
      error
    );

  }

}


// ------------------------------------------------------------
// СЛОВО «ПОДДЕРЖКА»
// ------------------------------------------------------------

bot.hears(/^поддержка$/i, async (ctx) => {

  await sendSupport(ctx);

});


// ------------------------------------------------------------
// СОХРАНЕНИЕ ЧАТОВ, В КОТОРЫХ РАБОТАЕТ БОТ
// ------------------------------------------------------------

async function registerSupportChat(ctx) {

  try {

    if (!ctx.chat?.id) {
      return;
    }

    const chatId = String(ctx.chat.id);

    const data = await db
      .collection(SUPPORT_COLLECTION)
      .findOne({
        key: SUPPORT_KEY
      });

    let chatIds = [];

    if (data && Array.isArray(data.chatIds)) {
      chatIds = data.chatIds;
    }

    if (!chatIds.includes(chatId)) {

      chatIds.push(chatId);

      await db
        .collection(SUPPORT_COLLECTION)
        .updateOne(
          {
            key: SUPPORT_KEY
          },
          {
            $set: {
              key: SUPPORT_KEY,
              chatIds,
              updatedAt: new Date()
            }
          },
          {
            upsert: true
          }
        );

    }

  } catch (error) {

    console.error(
      "SUPPORT CHAT REGISTER ERROR:",
      error
    );

  }

}


// ------------------------------------------------------------
// РЕГИСТРИРУЕМ ЧАТ
// ------------------------------------------------------------
//
// Бот запоминает чаты, в которых получает сообщения.
// Это нужно для автоматической отправки в 11:00 и 18:00.
//

bot.on("message", async (ctx, next) => {

  await registerSupportChat(ctx);

  if (next) {
    return next();
  }

});


// ------------------------------------------------------------
// ПОЛУЧЕНИЕ ЧАТОВ
// ------------------------------------------------------------

async function getSupportChats() {

  try {

    const data = await db
      .collection(SUPPORT_COLLECTION)
      .findOne({
        key: SUPPORT_KEY
      });

    if (
      !data ||
      !Array.isArray(data.chatIds)
    ) {
      return [];
    }

    return data.chatIds;

  } catch (error) {

    console.error(
      "SUPPORT GET CHATS ERROR:",
      error
    );

    return [];

  }

}


// ------------------------------------------------------------
// ПРОВЕРКА — БЫЛА ЛИ УЖЕ ОТПРАВКА
// ------------------------------------------------------------

async function wasSupportSent(slotKey) {

  try {

    const data = await db
      .collection(SUPPORT_COLLECTION)
      .findOne({
        key: SUPPORT_KEY
      });

    if (
      data &&
      data.lastSentSlot === slotKey
    ) {
      return true;
    }

    return false;

  } catch (error) {

    console.error(
      "SUPPORT CHECK ERROR:",
      error
    );

    return false;

  }

}


// ------------------------------------------------------------
// СОХРАНЕНИЕ ПОСЛЕДНЕЙ ОТПРАВКИ
// ------------------------------------------------------------

async function saveSupportSent(slotKey) {

  try {

    await db
      .collection(SUPPORT_COLLECTION)
      .updateOne(
        {
          key: SUPPORT_KEY
        },
        {
          $set: {
            key: SUPPORT_KEY,
            lastSentSlot: slotKey,
            updatedAt: new Date()
          }
        },
        {
          upsert: true
        }
      );

  } catch (error) {

    console.error(
      "SUPPORT SAVE ERROR:",
      error
    );

  }

}


// ------------------------------------------------------------
// АВТОМАТИЧЕСКАЯ ОТПРАВКА
// ------------------------------------------------------------

async function checkSupportSchedule() {

  try {

    const now = new Date();

    const kyivTime = new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    ).formatToParts(now);

    const parts = {};

    for (const part of kyivTime) {
      if (part.type !== "literal") {
        parts[part.type] = part.value;
      }
    }

    const year = parts.year;
    const month = parts.month;
    const day = parts.day;
    const hour = parts.hour;
    const minute = parts.minute;

    // Проверяем только первые минуты часа.
    if (
      minute !== "00" ||
      (hour !== "11" && hour !== "18")
    ) {
      return;
    }

    const slotKey =
      `${year}-${month}-${day}-${hour}`;

    // Защита от повторной отправки.
    if (await wasSupportSent(slotKey)) {
      return;
    }

    const chats = await getSupportChats();

    if (!chats.length) {
      return;
    }

    console.log(
      `❤️ SUPPORT: отправка ${hour}:00, чатов: ${chats.length}`
    );

    let successCount = 0;

    for (const chatId of chats) {

      try {

        await bot.telegram.sendMessage(
          chatId,
          SUPPORT_TEXT,
          {
            parse_mode: "HTML",
            reply_markup: supportKeyboard()
          }
        );

        successCount++;

      } catch (error) {

        console.error(
          `SUPPORT SEND ERROR ${chatId}:`,
          error.message || error
        );

      }

    }

    // Отмечаем слот отправленным только после попытки рассылки.
    await saveSupportSent(slotKey);

    console.log(
      `❤️ SUPPORT: отправлено успешно: ${successCount}/${chats.length}`
    );

  } catch (error) {

    console.error(
      "SUPPORT SCHEDULE ERROR:",
      error
    );

  }

}


// ------------------------------------------------------------
// ПРОВЕРЯЕМ РАСПИСАНИЕ КАЖДУЮ МИНУТУ
// ------------------------------------------------------------

setInterval(
  checkSupportSchedule,
  60 * 1000
);

// Проверяем сразу после запуска,
// чтобы не ждать первую минуту.
checkSupportSchedule();



// ============================================================
// 🌦️ АВТОПОГОДА ДЛЯ КУРЬЕРОВ — ОДЕССА
// 23:50 завтра; 06:50 прогноз на сегодня; 07:00 / 12:00 / 17:00 интервалы.
// ============================================================

const COURIER_WEATHER_LAT = 46.4825;
const COURIER_WEATHER_LON = 30.7233;
const WEATHER_SCHEDULE = {
  "23:50": { kind: "tomorrow", label: "Прогноз на завтра" },
  "06:50": { kind: "today", label: "Прогноз на сегодня" },
  "07:00": { kind: "range", start: 7, end: 12, label: "Погода 07:00–12:00" },
  "12:00": { kind: "range", start: 12, end: 17, label: "Погода 12:00–17:00" },
  "17:00": { kind: "range", start: 17, end: 24, label: "Погода 17:00–00:00" }
};

function weatherKyivParts(date = new Date()) {
  const out = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

function weatherDateKey(offsetDays = 0) {
  const p = weatherKyivParts();
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + offsetDays));
  return d.toISOString().slice(0, 10);
}

function weatherTimeLabel(iso) {
  return String(iso || "").slice(11, 16);
}

function weatherRecommendation(rows) {
  const maxRain = Math.max(0, ...rows.map(x => Number(x.precipitation_probability) || 0));
  const maxWind = Math.max(0, ...rows.map(x => Number(x.wind_speed_10m) || 0));
  const minTemp = Math.min(...rows.map(x => Number(x.temperature_2m)).filter(Number.isFinite));
  const maxTemp = Math.max(...rows.map(x => Number(x.temperature_2m)).filter(Number.isFinite));
  const notes = [];
  if (maxRain >= 60) notes.push("🌧️ Высокий риск дождя — возьми дождевик и защити телефон/зарядку.");
  else if (maxRain >= 30) notes.push("🌦️ Возможен дождь — дождевик лучше взять с собой.");
  else notes.push("☂️ Существенный дождь маловероятен по текущему прогнозу.");
  if (maxWind >= 35) notes.push("💨 Сильный ветер — осторожнее на открытых участках и мостах.");
  if (Number.isFinite(minTemp) && minTemp <= 8) notes.push("🧤 Прохладно — тёплый слой и перчатки пригодятся.");
  else if (Number.isFinite(maxTemp) && maxTemp >= 27) notes.push("🥤 Тепло — возьми воду и делай короткие паузы.");
  return notes.join("\n");
}

async function getOdesaWeatherText(slot, targetDate) {
  if (typeof fetch !== "function") {
    throw new Error("В среде бота недоступен fetch для погодного API");
  }
  const url = "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" + COURIER_WEATHER_LAT +
    "&longitude=" + COURIER_WEATHER_LON +
    "&hourly=temperature_2m,precipitation_probability,wind_speed_10m" +
    "&timezone=Europe%2FKyiv&forecast_days=3";
  const response = await fetch(url);
  if (!response.ok) throw new Error("Open-Meteo HTTP " + response.status);
  const data = await response.json();
  if (!data.hourly || !Array.isArray(data.hourly.time)) throw new Error("Пустой ответ Open-Meteo");

  let rows = data.hourly.time.map((time, i) => ({
    time,
    temperature_2m: data.hourly.temperature_2m?.[i],
    precipitation_probability: data.hourly.precipitation_probability?.[i],
    wind_speed_10m: data.hourly.wind_speed_10m?.[i]
  })).filter(row => row.time.startsWith(targetDate));

  if (slot.kind === "range") {
    rows = rows.filter(row => {
      const hour = Number(row.time.slice(11, 13));
      return hour >= slot.start && hour < slot.end;
    });
  }
  if (slot.kind === "today" || slot.kind === "tomorrow") {
    rows = rows.filter(row => {
      const hour = Number(row.time.slice(11, 13));
      return hour >= 0 && hour < 24;
    });
  }
  if (!rows.length) throw new Error("Нет почасового прогноза на " + targetDate);

  const lines = rows.map(row => {
    const temp = Number.isFinite(Number(row.temperature_2m)) ? Math.round(Number(row.temperature_2m)) + "°C" : "—";
    const rain = Number.isFinite(Number(row.precipitation_probability)) ? Math.round(Number(row.precipitation_probability)) + "%" : "—";
    const wind = Number.isFinite(Number(row.wind_speed_10m)) ? Math.round(Number(row.wind_speed_10m)) + " км/ч" : "—";
    return weatherTimeLabel(row.time) + " — " + temp + " | дождь " + rain + " | ветер " + wind;
  });
  const displayDate = targetDate.split("-").reverse().join(".");
  const title = slot.label + " · Одесса · " + displayDate;
  let body = "🌦️ <b>" + title + "</b>\n\n" + lines.join("\n");
  const advice = weatherRecommendation(rows);
  if (advice) body += "\n\n<b>Курьеру:</b>\n" + advice;
  return body;
}

async function getOdesaNextThreeHoursWeatherText() {
  if (typeof fetch !== "function") {
    throw new Error("В среде бота недоступен fetch для погодного API");
  }
  const url = "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" + COURIER_WEATHER_LAT +
    "&longitude=" + COURIER_WEATHER_LON +
    "&hourly=temperature_2m,precipitation_probability,wind_speed_10m" +
    "&timezone=Europe%2FKyiv&forecast_days=3";
  const response = await fetch(url);
  if (!response.ok) throw new Error("Open-Meteo HTTP " + response.status);
  const data = await response.json();
  if (!data.hourly || !Array.isArray(data.hourly.time)) {
    throw new Error("Пустой ответ Open-Meteo");
  }

  // Берём текущий час и два следующих почасовых прогноза.
  const now = weatherKyivParts();
  const startTime = now.year + "-" + now.month + "-" + now.day + "T" + now.hour + ":00";
  const rows = data.hourly.time.map((time, i) => ({
    time,
    temperature_2m: data.hourly.temperature_2m?.[i],
    precipitation_probability: data.hourly.precipitation_probability?.[i],
    wind_speed_10m: data.hourly.wind_speed_10m?.[i]
  })).filter(row => row.time >= startTime).slice(0, 3);

  if (!rows.length) throw new Error("Нет почасового прогноза на ближайшие часы");

  const lines = rows.map(row => {
    const temp = Number.isFinite(Number(row.temperature_2m)) ? Math.round(Number(row.temperature_2m)) + "°C" : "—";
    const rain = Number.isFinite(Number(row.precipitation_probability)) ? Math.round(Number(row.precipitation_probability)) + "%" : "—";
    const wind = Number.isFinite(Number(row.wind_speed_10m)) ? Math.round(Number(row.wind_speed_10m)) + " км/ч" : "—";
    return weatherTimeLabel(row.time) + " — " + temp + " | дождь " + rain + " | ветер " + wind;
  });

  let body = "🌦️ <b>Прогноз на ближайшие 3 часа · Одесса</b>\n\n" + lines.join("\n");
  const advice = weatherRecommendation(rows);
  if (advice) body += "\n\n<b>Курьеру:</b>\n" + advice;
  return body;
}

bot.hears(/^прогноз$/i, async ctx => {
  try {
    const message = await getOdesaNextThreeHoursWeatherText();
    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("MANUAL WEATHER FORECAST ERROR:", error.message || error);
    await ctx.reply("❌ Не удалось получить прогноз погоды. Попробуй немного позже.");
  }
});

async function checkCourierWeatherSchedule() {
  try {
    const p = weatherKyivParts();
    const hhmm = p.hour + ":" + p.minute;
    const slot = WEATHER_SCHEDULE[hhmm];
    if (!slot) return;
    const slotKey = p.year + "-" + p.month + "-" + p.day + "-" + hhmm;
    const existing = await db.collection(SUPPORT_COLLECTION).findOne({ key: SUPPORT_KEY });
    if (existing && existing.weatherLastSentSlot === slotKey) return;
    const chats = await getSupportChats();
    if (!chats.length) {
      console.log("WEATHER: пока нет зарегистрированных чатов для рассылки.");
      return;
    }
    const targetDate = slot.kind === "tomorrow" ? weatherDateKey(1) :
      slot.kind === "today" ? weatherDateKey(0) : weatherDateKey(0);
    const message = await getOdesaWeatherText(slot, targetDate);
    let sent = 0;
    for (const chatId of chats) {
      try {
        await bot.telegram.sendMessage(chatId, message, { parse_mode: "HTML" });
        sent++;
      } catch (error) {
        console.error("WEATHER SEND ERROR " + chatId + ":", error.message || error);
      }
    }
    await db.collection(SUPPORT_COLLECTION).updateOne(
      { key: SUPPORT_KEY },
      { $set: { key: SUPPORT_KEY, weatherLastSentSlot: slotKey, weatherUpdatedAt: Date.now() } },
      { upsert: true }
    );
    console.log("🌦️ WEATHER: отправлено " + sent + "/" + chats.length + " для слота " + hhmm);
  } catch (error) {
    console.error("WEATHER SCHEDULE ERROR:", error.message || error);
  }
}

setInterval(checkCourierWeatherSchedule, 60 * 1000);
checkCourierWeatherSchedule();


// ============================================================
// КОНЕЦ БЛОКА «ПОДДЕРЖКА АВТОРА»
// ============================================================
// ============================================================
// 🚨 НОВЫЕ КОМАНДЫ — СИГНАЛЫ / ЛОКАЦИИ / BOLT
// Вставить ЦЕЛИКОМ в самый низ текущего кода
// ============================================================

// ------------------------------------------------------------
// Вспомогательная функция:
// отвечает на команду и затем удаляет сообщение пользователя
// ------------------------------------------------------------
async function replyAndDeleteTrigger(ctx, text) {
  try {
    await ctx.reply(text, { parse_mode: 'HTML' });

    try {
      await ctx.deleteMessage();
    } catch (deleteError) {
      // Если бот не может удалить сообщение — просто продолжаем работу
      console.log('Не удалось удалить сообщение пользователя:', deleteError.message);
    }
  } catch (error) {
    console.error('Ошибка дополнительной команды:', error);
  }
}


// ------------------------------------------------------------
// 🚨 РМ — РЕАКТИВНЫЙ В МОРЕ
// ------------------------------------------------------------
bot.hears(/^рм$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🚨🚨🚨\n<b>РЕАКТИВНЫЙ В МОРЕ</b>\n🚨🚨🚨'
  );
});


// ------------------------------------------------------------
// 🚨 РГ — РЕАКТИВНЫЙ НА ГОРОД
// ------------------------------------------------------------
bot.hears(/^рг$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🚨🚨🚨\n<b>РЕАКТИВНЫЙ НА ГОРОД</b>\n🚨🚨🚨'
  );
});


// ------------------------------------------------------------
// 🚨 ТЦ — РЕАКТИВНЫЙ НА СИТИ ЦЕНТР
// ------------------------------------------------------------
bot.hears(/^тц$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🚨🚨🚨\n<b>РЕАКТИВНЫЙ НА СИТИ ЦЕНТР</b>\n🚨🚨🚨'
  );
});


// ------------------------------------------------------------
// 🌊 ОМ — ОБЫЧНЫЙ В МОРЕ
// ------------------------------------------------------------
bot.hears(/^ом$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🌊🌊🌊\n<b>ОБЫЧНЫЙ В МОРЕ</b>\n🌊🌊🌊'
  );
});


// ------------------------------------------------------------
// 🏙️ ОГ — ОБЫЧНЫЙ НА ГОРОД
// ------------------------------------------------------------
bot.hears(/^ог$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🏙️🏙️🏙️\n<b>ОБЫЧНЫЙ НА ГОРОД</b>\n🏙️🏙️🏙️'
  );
});


// ------------------------------------------------------------
// 🌾 ПОСКОТ — СЕЛО В НИКОЛАЕВСКОЙ ОБЛАСТИ
// ------------------------------------------------------------
bot.hears(/^поскот$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🌾🌾🌾\n<b>ПОСКОТ - СЕЛО В НИКОЛАЕВСКОЙ ОБЛАСТИ</b>\n🌾🌾🌾'
  );
});


// ------------------------------------------------------------
// ⚡ BOLT
// ------------------------------------------------------------
bot.hears(/^болт$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '⚡⚡⚡\n<b>ВКЛЮЧАЕМ BOLT</b>\n\n' +
    '@smurf1108\n' +
    '@Aleksandr111020\n' +
    '@j4_denmaRk\n' +
    '@ser99ii\n\n' +
    '⚡⚡⚡'
  );
});


// ============================================================
// КОНЕЦ ДОПОЛНИТЕЛЬНОГО БЛОКА
// ============================================================
// ============================================================
// ЧЕТВЕРГ: НАПОМИНАНИЯ «ДИАМАНТ» И «ЗОЛОТО»
// ============================================================
const SESSION_BOOKING_DB_COLLECTION = "courier-session-booking";
const SESSION_BOOKING_DB_KEY = "main";
const SESSION_REMINDERS = [
  { key: "diamond", hour: 13, minute: 59, text: "💎 ДИАМАНТЫ! Пора набирать сессии! Не упускаем возможность заработать — подключаемся и активно работаем! 💪\n\n@Invisiibllee @Aleksandr111020 @swixwx @B_aa_l_d @smurf1108" },
  { key: "gold", hour: 14, minute: 29, text: "🥇 ЗОЛОТО! Время набирать сессии! Показываем результат, забираем свои показатели и не сбавляем обороты! 🔥\n\n@B_aa_l_d @globalist88 @ser99ii" }
];

function getKyivDateTimeForSessions() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) };
}
function getKyivDateKeyForSessions() {
  const t = getKyivDateTimeForSessions();
  return String(t.year) + "-" + String(t.month).padStart(2, "0") + "-" + String(t.day).padStart(2, "0");
}
async function rememberLastGroupForSessions(ctx) {
  try {
    if (!ctx?.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
    const old = await db.collection(SESSION_BOOKING_DB_COLLECTION).findOne({ key: SESSION_BOOKING_DB_KEY });
    const data = { ...(old?.data || {}), lastGroupChatId: ctx.chat.id, lastGroupChatTitle: ctx.chat.title || "", updatedAt: new Date().toISOString() };
    await db.collection(SESSION_BOOKING_DB_COLLECTION).updateOne(
      { key: SESSION_BOOKING_DB_KEY },
      { $set: { key: SESSION_BOOKING_DB_KEY, data, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.error("Ошибка сохранения группового чата для напоминаний:", error.message);
  }
}
async function checkSessionBookingNotification() {
  try {
    const t = getKyivDateTimeForSessions();
    if (new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay() !== 4) return;
    const dateKey = getKyivDateKeyForSessions();
    const old = await db.collection(SESSION_BOOKING_DB_COLLECTION).findOne({ key: SESSION_BOOKING_DB_KEY });
    const data = old?.data || {};
    if (!data.lastGroupChatId) return;
    for (const reminder of SESSION_REMINDERS) {
      if (t.hour !== reminder.hour || t.minute !== reminder.minute) continue;
      const sentKey = "lastSent_" + reminder.key;
      if (data[sentKey] === dateKey) continue;
      await bot.telegram.sendMessage(data.lastGroupChatId, reminder.text);
      data[sentKey] = dateKey;
      data.updatedAt = new Date().toISOString();
      await db.collection(SESSION_BOOKING_DB_COLLECTION).updateOne(
        { key: SESSION_BOOKING_DB_KEY },
        { $set: { key: SESSION_BOOKING_DB_KEY, data, updatedAt: new Date() } },
        { upsert: true }
      );
      console.log("Напоминание " + reminder.key + " отправлено в чат " + data.lastGroupChatId);
    }
  } catch (error) {
    console.error("Ошибка автоматических напоминаний:", error.message);
  }
}
// Групповой чат уже запоминается ранним middleware в начале файла.
setInterval(checkSessionBookingNotification, 15 * 1000);
setTimeout(checkSessionBookingNotification, 5000);


// ============================================================
// ВОЗДУШНАЯ ТРЕВОГА
// ТР  — тревога
// ОТ  — отбой
// ОТР — тревога по области
// ============================================================

bot.hears(/^тр$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🚨🚨🚨\n\n' +
    '🔴 <b>ОБЪЯВЛЕНА ВОЗДУШНАЯ ТРЕВОГА</b> 🔴\n\n' +
    '🚨⚠️🚨⚠️🚨\n\n' +
    '‼️ Будьте внимательны и следите за сообщениями Санька.\n\n' +
    '🚨🚨🚨'
  );
});

bot.hears(/^от$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🟢🟢🟢\n\n' +
    '✅ <b>ОТБОЙ ВОЗДУШНОЙ ТРЕВОГИ</b> ✅\n\n' +
    '🕊️🌤️🕊️🌤️🕊️\n\n' +
    '💚 Можно возвращаться к обычным делам.\n\n' +
    '🟢🟢🟢'
  );
});

bot.hears(/^отр$/i, async (ctx) => {
  await replyAndDeleteTrigger(
    ctx,
    '🚨🚨🚨\n\n' +
    '🔴 <b>ОБЪЯВЛЕНА ВОЗДУШНАЯ ТРЕВОГА (ОБЛАСТЬ)</b> 🔴\n\n' +
    '⚠️📢⚠️📢⚠️\n\n' +
    '‼️ Будьте внимательны и следите за сообщениями Санька.\n\n' +
    '🚨🚨🚨'
  );
});
// ============================================================
// 🔇 СИСТЕМА МУТОВ — 100 СТАДИЙ
// Использование: Reply на сообщение пользователя →
//                 "мут причина"
// 1 стадия = 1 минута
// 100 стадия = 100 минут
// Если 30 дней нет новых нарушений → стадия сбрасывается на 1
// ============================================================

const MUTE_COLLECTION = "courier-bot-mutes";
const MUTE_RESET_DAYS = 30;
const MUTE_MAX_STAGE = 100;


// ------------------------------------------------------------
// Получение данных о стадии пользователя
// ------------------------------------------------------------
async function getMuteData(chatId, userId) {
  const key = `${chatId}_${userId}`;

  const data = await db.get(MUTE_COLLECTION, key);

  if (!data) {
    return {
      stage: 0,
      lastViolation: null
    };
  }

  return data;
}


// ------------------------------------------------------------
// Сохранение данных о стадии
// ------------------------------------------------------------
async function saveMuteData(chatId, userId, data) {
  const key = `${chatId}_${userId}`;

  await db.set(MUTE_COLLECTION, key, data);
}


// ------------------------------------------------------------
// Проверка: прошло ли 30 дней с последнего нарушения
// ------------------------------------------------------------
function muteStageExpired(lastViolation) {
  if (!lastViolation) return true;

  const now = Date.now();
  const last = new Date(lastViolation).getTime();

  const thirtyDays =
    MUTE_RESET_DAYS * 24 * 60 * 60 * 1000;

  return (now - last) >= thirtyDays;
}


// ------------------------------------------------------------
// Проверка, является ли пользователь администратором
// ------------------------------------------------------------
async function isMuteAdmin(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(
      ctx.chat.id,
      ctx.from.id
    );

    return (
      member.status === "creator" ||
      member.status === "administrator"
    );
  } catch (e) {
    console.error("Ошибка проверки администратора:", e);
    return false;
  }
}

// ============================================================
// 📍 ПУНКТЫ ОТМЕНЫ — ГЕОПОЗИЦИЯ + БЛИЖАЙШИЕ ПУНКТЫ
// Перенесено из исходного Glovo-бота в формат Telegraf/NxCreate.
// ============================================================

const CP_RESULTS_LIMIT = 3;

// В исходном боте фактически установлено 300 секунд.
// То есть 5 минут.
const CP_DELETE_DELAY_MS = 5 * 60 * 1000;

// ------------------------------------------------------------
// 🗺 ССЫЛКИ
// ------------------------------------------------------------

const CP_MAP_URL =
  "https://www.google.com/maps/d/u/0/viewer?mid=1bIOWYC9aWU7JbdjZqoOiwTkcWGB8PHL2&ll=46.43214046379385%2C30.788218608718545&z=13";

const CP_HELP_URL =
  "https://t.me/GLOVOinform/1950";


// ------------------------------------------------------------
// 🔎 МАРКЕР СООБЩЕНИЯ С ЗАПРОСОМ ГЕОПОЗИЦИИ
// ------------------------------------------------------------

const CP_LOCATION_PROMPT_MARKER =
  "Пришліть вашу геопозицію";


// ------------------------------------------------------------
// 📅 ДНИ НЕДЕЛИ
// ------------------------------------------------------------

const CP_WEEKDAY_KEYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat"
];

const CP_WEEKDAY_NAMES = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П'ятниця",
  "Субота"
];


// ------------------------------------------------------------
// 🔢 НУМЕРАЦИЯ
// ------------------------------------------------------------

const CP_NUMBER_EMOJI = [
  "1️⃣",
  "2️⃣",
  "3️⃣",
  "4️⃣",
  "5️⃣",
  "6️⃣",
  "7️⃣",
  "8️⃣",
  "9️⃣",
  "🔟"
];


// ============================================================
// 📍 ПУНКТЫ ОТМЕНЫ
// Данные перенесены из исходного бота.
// ============================================================

const CP_POINTS = [

  {
    id: "vitry_zmin",
    name: "Благодійний Фонд «Вітри Змін»",
    address: "вул. Велика Арнаутська, 76",

    lat: 46.4732804,
    lon: 30.7330295,

    phone: "+380957064751",
    contact_name: "Валентин",

    accepts:
      "їжа + цигарки (алкоголь НЕ приймають)",

    note:
      "Перед приїздом обов'язково зателефонувати в Вайбер.",

    schedule: {
      mon: [["10:00", "18:00"]],
      tue: [["10:00", "18:00"]],
      wed: [["10:00", "18:00"]],
      thu: [["10:00", "18:00"]],
      fri: [["10:00", "18:00"]],
      sat: [["10:00", "18:00"]],
      sun: []
    }
  },


  {
    id: "military_hospital",
    name: "Військовий клінічний шпиталь",
    address: "вул. Пироговська 2/2",

    lat: 46.4642173,
    lon: 30.7518654,

    phone:
      "+380675596347 (Лілія), +380988286257 (Олена)",

    contact_name: null,

    accepts: "все",

    note:
      "Зателефонувати зазделегіть і по факту приізду",

    schedule: {
      mon: [["10:00", "19:00"]],
      tue: [["10:00", "19:00"]],
      wed: [["10:00", "19:00"]],
      thu: [["10:00", "19:00"]],
      fri: [["10:00", "19:00"]],
      sat: [["10:00", "19:00"]],
      sun: []
    }
  },


  {
    id: "korporatsiya_monstriv",
    name: "Корпорація Монстрів",

    address:
      "Французький бульвар 28/30 (центральний вхід, чорні ворота)",

    lat: 46.4535571,
    lon: 30.7590392,

    phone: "+380667152822",
    contact_name: null,

    accepts: "все",

    note:
      "⚠️ На території може бути собака. Зателефонувати за фактом приїзду.",

    call_first: true,

    schedule: {
      mon: [["10:00", "18:00"]],
      tue: [["10:00", "18:00"]],
      wed: [["10:00", "18:00"]],
      thu: [["10:00", "18:00"]],
      fri: [["10:00", "18:00"]],
      sat: [["10:00", "18:00"]],
      sun: [["10:00", "18:00"]]
    }
  },


  {
    id: "feeding_point",
    name: "Пункт годівлі безпритульних",

    address:
      "вул. Федора Пішеніна, 49",

    lat: 46.4512071,
    lon: 30.7139051,

    phone: "+380935784531",
    contact_name: null,

    accepts: "тільки продукти!",

    note: null,

    schedule: {
      mon: [["10:00", "16:00"]],
      tue: [["10:00", "16:00"]],
      wed: [["10:00", "16:00"]],
      thu: [["10:00", "16:00"]],
      fri: [["10:00", "16:00"]],
      sat: [],
      sun: []
    }
  },


  {
    id: "magnitogorskyi",

    name:
      "пров. Магнітогорський 1-й, 3Т (сірі ворота)",

    address:
      "пров. Магнітогорський 1-й, 3Т",

    lat: 46.3845109,
    lon: 30.7438543,

    phone: "+380931901477",
    contact_name: null,

    accepts: "алкоголь/сигарети",

    note:
      "У інший час — зателефонувати заздалегідь.",

    schedule: {
      mon: [
        ["10:00", "12:00"],
        ["17:00", "19:00"]
      ],

      tue: [
        ["10:00", "12:00"],
        ["17:00", "19:00"]
      ],

      wed: [
        ["10:00", "12:00"],
        ["17:00", "19:00"]
      ],

      thu: [
        ["10:00", "12:00"],
        ["17:00", "19:00"]
      ],

      fri: [
        ["10:00", "12:00"],
        ["17:00", "19:00"]
      ],

      sat: [
        ["10:00", "12:00"],
        ["17:00", "19:00"]
      ],

      sun: [
        ["10:00", "12:00"],
        ["17:00", "19:00"]
      ]
    }
  },


  {
    id: "tyraspolska",

    name:
      "вул. Тираспольська, 18",

    address:
      "вул. Тираспольська, 18",

    lat: 46.4776923,
    lon: 30.7271233,

    phone: "+380957064751",
    contact_name: "Валентин",

    accepts: "все",

    note:
      "Перед приїздом обов'язково зателефонувати в Вайбер.",

    schedule: {
      mon: [["10:00", "18:00"]],
      tue: [["10:00", "18:00"]],
      wed: [["10:00", "18:00"]],
      thu: [["10:00", "18:00"]],
      fri: [["10:00", "18:00"]],
      sat: [["10:00", "18:00"]],
      sun: []
    }
  },


  {
    id: "parus_fitness",

    name:
      "Фітнес-клуб «Parus»",

    address:
      "вул. Літературна, 1А",

    lat: 46.4209567,
    lon: 30.7606889,

    phone: "+380997398022",
    contact_name: null,

    always_open: true,

    accepts: "все",

    note:
      "Віддавати замовлення охороні ЖК, фотагрофувати щось в якості доказів що віддали замовлення.",

    schedule: {
      mon: [["00:00", "23:59"]],
      tue: [["00:00", "23:59"]],
      wed: [["00:00", "23:59"]],
      thu: [["00:00", "23:59"]],
      fri: [["00:00", "23:59"]],
      sat: [["00:00", "23:59"]],
      sun: [["00:00", "23:59"]]
    }
  },


  {
    id: "martial_arts_club",

    name:
      "Клуб спортивних єдиноборств",

    address:
      "вул. Багрицького, 12а",

    lat: 46.4425205,
    lon: 30.722897,

    phone: "+380632023814",
    contact_name:
      "Володимир Анатолійович",

    accepts: "все",

    note:
      "⚠️ Тільки після підтвердження по телефону — зателефонувати заздалегідь обов'язково.",

    call_first: true,

    schedule: {
      mon: [["14:00", "20:00"]],
      tue: [["14:00", "20:00"]],
      wed: [["14:00", "20:00"]],
      thu: [["14:00", "20:00"]],
      fri: [["14:00", "20:00"]],
      sat: [["14:00", "20:00"]],
      sun: [["14:00", "20:00"]]
    }
  },


  {
    id: "borovskoho",

    name:
      "вул. Миколи Боровського, 26",

    address:
      "вул. Миколи Боровського, 26",

    lat: 46.4837327,
    lon: 30.6682052,

    phone: "+380976551447",
    contact_name: "Микола",

    accepts: "все",

    note: null,

    schedule: {
      mon: [["08:00", "23:00"]],
      tue: [["08:00", "23:00"]],
      wed: [["08:00", "23:00"]],
      thu: [["08:00", "23:00"]],
      fri: [["08:00", "23:00"]],
      sat: [["08:00", "23:00"]],
      sun: [["08:00", "23:00"]]
    }
  },


  {
    id: "panteleymonivska",

    name:
      "Пантелеймонівська, 56",

    address:
      "Пантелеймонівська, 56 (біля Макдональдса, вхід між «Точкой» і «Хуманой»)",

    lat: 46.4697074,
    lon: 30.742925,

    phone: "+380667152822",
    contact_name: null,

    accepts: "все",

    note:
      "⚠️ Працює ТІЛЬКИ у вівторок та четвер!",

    schedule: {
      mon: [],
      tue: [["10:00", "18:00"]],
      wed: [],
      thu: [["10:00", "18:00"]],
      fri: [],
      sat: [],
      sun: []
    }
  },


  {
    id: "stepova",

    name:
      "вул. Степова, 23",

    address:
      "вул. Степова 23/25, приватний будинок",

    lat: 46.5723372,
    lon: 30.7684103,

    phone: "+380681819630",
    contact_name: "Олена",

    accepts: "все",

    note: null,

    schedule: {
      mon: [["07:00", "23:00"]],
      tue: [["07:00", "23:00"]],
      wed: [["07:00", "23:00"]],
      thu: [["07:00", "23:00"]],
      fri: [["07:00", "23:00"]],
      sat: [["07:00", "23:00"]],
      sun: [["07:00", "23:00"]]
    }
  },


  {
    id: "lustdorfska",

    name:
      "15-та лінія Люстдорфської дороги, 51",

    address:
      "15-та лінія Люстдорфської дороги, 51",

    lat: 46.4028239,
    lon: 30.7167645,

    phone: "+380777177474",
    contact_name: null,

    accepts: "все",

    note: null,

    schedule: {
      mon: [["08:00", "18:00"]],
      tue: [["08:00", "18:00"]],
      wed: [["08:00", "18:00"]],
      thu: [["08:00", "18:00"]],
      fri: [["08:00", "18:00"]],
      sat: [["08:00", "18:00"]],
      sun: [["08:00", "18:00"]]
    }
  }

];


// ============================================================
// 📐 РАСЧЁТ РАССТОЯНИЯ
// ============================================================

function cpHaversineKm(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371;

  const toRad =
    value =>
      value * Math.PI / 180;

  const dLat =
    toRad(lat2 - lat1);

  const dLon =
    toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(a)
    )
  );
}


// ============================================================
// 🕐 ВРЕМЯ
// ============================================================

function cpTimeToMinutes(value) {

  const parts =
    String(value)
      .split(":")
      .map(Number);

  return (
    parts[0] * 60 +
    parts[1]
  );
}


// ============================================================
// 🟢 ПРОВЕРКА ОТКРЫТИЯ
// ============================================================

function cpIsOpenNow(
  point,
  now = new Date()
) {

  if (point.always_open) {

    return {
      open: true,
      ranges: [
        ["00:00", "23:59"]
      ]
    };

  }

  const dayKey =
    CP_WEEKDAY_KEYS[
    now.getDay()
    ];

  const ranges =
    point.schedule?.[dayKey] || [];

  const current =
    now.getHours() * 60 +
    now.getMinutes();

  for (
    const [
      start,
      end
    ] of ranges
  ) {

    if (
      cpTimeToMinutes(start) <= current &&
      current <= cpTimeToMinutes(end)
    ) {

      return {
        open: true,
        ranges
      };

    }

  }

  return {
    open: false,
    ranges
  };
}


// ============================================================
// 🔒 HTML-БЕЗОПАСНОСТЬ
// ============================================================

function cpEscapeHtml(value) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    );
}


// ============================================================
// 🕐 ФОРМАТ РАСПИСАНИЯ
// ============================================================

function cpFormatSchedule(
  point,
  ranges
) {

  if (point.always_open) {
    return "цілодобово";
  }

  if (!ranges.length) {
    return "сьогодні вихідний";
  }

  return ranges
    .map(
      ([start, end]) =>
        `${start}–${end}`
    )
    .join(" та ");
}


// ============================================================
// 📍 ПОИСК БЛИЖАЙШИХ
// ============================================================

function cpFindNearest(
  lat,
  lon
) {

  const now =
    new Date();

  return CP_POINTS
    .map(point => {

      const status =
        cpIsOpenNow(
          point,
          now
        );

      return {

        point,

        distance:
          cpHaversineKm(
            lat,
            lon,
            point.lat,
            point.lon
          ),

        open:
          status.open,

        ranges:
          status.ranges

      };

    })

    // Сначала открытые,
    // внутри группы — ближайшие.
    .sort(
      (a, b) =>
        Number(!a.open) -
        Number(!b.open) ||
        a.distance -
        b.distance
    )

    .slice(
      0,
      CP_RESULTS_LIMIT
    );
}


// ============================================================
// 🗺 КНОПКИ GOOGLE MAPS / WAZE
// ============================================================

function cpNavigationKeyboard(
  results
) {

  return {

    inline_keyboard:

      results.map(
        (item, index) => {

          const label =
            CP_NUMBER_EMOJI[index] ||
            `${index + 1}.`;

          const google =
            `https://www.google.com/maps/dir/?api=1&destination=${item.point.lat},${item.point.lon}`;

          const waze =
            `https://waze.com/ul?ll=${item.point.lat},${item.point.lon}&navigate=yes`;

          return [

            {
              text:
                `${label} 🗺 Google Maps`,
              url:
                google
            },

            {
              text:
                `${label} 🚗 Waze`,
              url:
                waze
            }

          ];

        }
      )

  };

}


// ============================================================
// 📝 ФОРМИРОВАНИЕ ПУНКТА
// ============================================================

function cpFormatPoint(
  index,
  item
) {

  const {
    point,
    distance,
    open,
    ranges
  } = item;

  const label =
    CP_NUMBER_EMOJI[index] ||
    `${index + 1}.`;

  const lines = [

    `${label} ${open
      ? "🟢 Відкрито"
      : "🔴 Зачинено"
    } · <b>${cpEscapeHtml(
      point.name
    )
    }</b> — ${distance.toFixed(1)
    } км`,

    `📍 ${cpEscapeHtml(
      point.address
    )
    }`,

    `🕐 Сьогодні: ${cpEscapeHtml(
      cpFormatSchedule(
        point,
        ranges
      )
    )
    }`

  ];


  if (point.phone) {

    const contact =
      point.contact_name
        ? ` (${cpEscapeHtml(
          point.contact_name
        )
        })`
        : "";

    lines.push(
      `📞 ${cpEscapeHtml(
        point.phone
      )
      }${contact}`
    );

  }


  if (point.accepts) {

    lines.push(
      `📦 Приймають: ${cpEscapeHtml(
        point.accepts
      )
      }`
    );

  }


  if (point.call_first) {

    lines.push(
      "⚠️ Обов'язково зателефонувати заздалегідь!"
    );

  }


  if (point.note) {

    lines.push(
      `ℹ️ ${cpEscapeHtml(
        point.note
      )
      }`
    );

  }


  return lines.join(
    "\n"
  );
}


// ============================================================
// 🗑 БЕЗОПАСНОЕ УДАЛЕНИЕ
// ============================================================

async function cpDeleteSafe(
  ctx,
  chatId,
  messageId,
  name
) {

  if (!messageId) {
    return;
  }

  try {

    await ctx.telegram.deleteMessage(
      chatId,
      messageId
    );

  } catch (error) {

    console.log(
      `ПУНКТИ ОТМЕНИ: не удалось удалить ${name}:`,
      error.message || error
    );

  }

}


// ============================================================
// ⏱ АВТОУДАЛЕНИЕ ЧЕРЕЗ 5 МИНУТ
// ============================================================

function cpScheduleDelete(
  ctx,
  chatId,
  promptMessageId,
  locationMessageId,
  resultMessageId
) {

  setTimeout(
    async () => {

      await cpDeleteSafe(
        ctx,
        chatId,
        promptMessageId,
        "сообщение-приглашение"
      );

      await cpDeleteSafe(
        ctx,
        chatId,
        locationMessageId,
        "геопозицию пользователя"
      );

      await cpDeleteSafe(
        ctx,
        chatId,
        resultMessageId,
        "результат"
      );

    },
    CP_DELETE_DELAY_MS
  );

}


// ============================================================
// 📍 «БОТ ОТМЕНА»
// ============================================================

bot.hears(
  /^бот отмена$/i,
  async ctx => {

    try {

      const prompt =
        await ctx.reply(

          "📍 Пришліть вашу геопозицію ВІДПОВІДДЮ на це повідомлення " +
          "(натисніть «Відповісти» на це повідомлення → скріпка → «Геопозиція»), " +
          "і я покажу 3 найближчих пунктів відмови — спочатку відкриті прямо зараз.\n\n" +
          "Або скористайтесь картою нижче:",

          {
            reply_markup: {

              inline_keyboard: [

                [
                  {
                    text:
                      "🗺 Карта пунктов отмены",

                    url:
                      CP_MAP_URL
                  }
                ],

                [
                  {
                    text:
                      "ℹ️ Инструкция, если карта не открывается",

                    url:
                      CP_HELP_URL
                  }
                ]

              ]

            }
          }

        );


      // Как в исходном боте —
      // удаляем сообщение "бот отмена".

      try {

        await ctx.deleteMessage();

      } catch (error) {

        console.log(
          "ПУНКТИ ОТМЕНИ: не удалось удалить 'бот отмена':",
          error.message || error
        );

      }

      return prompt;

    } catch (error) {

      console.error(
        "ПУНКТИ ОТМЕНИ: ошибка команды:",
        error
      );

    }

  }
);


// ============================================================
// 📍 ПОЛУЧЕНИЕ ГЕОПОЗИЦИИ
// ============================================================
//
// Принимается ТОЛЬКО если:
// пользователь отправил геопозицию
// ОТВЕТОМ на сообщение бота.
//
// ============================================================

bot.on(
  "location",
  async ctx => {

    try {

      const message =
        ctx.message;

      const reply =
        message?.reply_to_message;


      // Нет ответа на сообщение —
      // игнорируем геопозицию.

      if (
        !reply ||
        !reply.text
      ) {

        return;

      }


      // Проверяем, что это именно
      // наше сообщение с приглашением.

      if (
        !reply.text.includes(
          CP_LOCATION_PROMPT_MARKER
        )
      ) {

        return;

      }


      // Проверяем, что ответ был
      // именно на сообщение нашего бота.

      const botId =
        ctx.botInfo?.id;

      if (
        botId &&
        reply.from?.id !== botId
      ) {

        return;

      }


      const loc =
        message.location;

      if (!loc) {
        return;
      }


      // --------------------------------------------------------
      // ИЩЕМ БЛИЖАЙШИЕ ПУНКТЫ
      // --------------------------------------------------------

      const results =
        cpFindNearest(
          loc.latitude,
          loc.longitude
        );


      // --------------------------------------------------------
      // НИЧЕГО НЕ НАШЛИ
      // --------------------------------------------------------

      if (
        !results.length
      ) {

        const result =
          await ctx.reply(
            "Не вдалося знайти пункти відмови поруч."
          );

        cpScheduleDelete(
          ctx,
          ctx.chat.id,
          reply.message_id,
          message.message_id,
          result.message_id
        );

        return;

      }


      // --------------------------------------------------------
      // КОЛИЧЕСТВО ОТКРЫТЫХ
      // --------------------------------------------------------

      const openCount =
        results.filter(
          item =>
            item.open
        ).length;


      const weekday =
        CP_WEEKDAY_NAMES[
        new Date().getDay()
        ];


      // --------------------------------------------------------
      // ФОРМИРУЕМ РЕЗУЛЬТАТ
      // --------------------------------------------------------

      let text =
        `📍 Найближчі пункти скасування ` +
        `(сьогодні ${weekday}):\n\n`;


      text +=
        results
          .map(
            (item, index) =>
              cpFormatPoint(
                index,
                item
              )
          )
          .join(
            "\n\n"
          );


      // Если все ближайшие закрыты.

      if (
        openCount === 0
      ) {

        text +=
          "\n\n⚠️ Жоден із найближчих пунктів зараз не працює — це найближчі за розташуванням.";

      }


      // --------------------------------------------------------
      // ОТПРАВЛЯЕМ РЕЗУЛЬТАТ
      // --------------------------------------------------------

      const result =
        await ctx.reply(
          text,
          {
            parse_mode:
              "HTML",

            reply_markup:
              cpNavigationKeyboard(
                results
              )
          }
        );


      // --------------------------------------------------------
      // АВТОУДАЛЕНИЕ
      // --------------------------------------------------------

      cpScheduleDelete(
        ctx,
        ctx.chat.id,

        // Сообщение бота
        // с просьбой отправить геопозицию
        reply.message_id,

        // Геопозиция пользователя
        message.message_id,

        // Результат
        result.message_id
      );


    } catch (error) {

      console.error(
        "ПУНКТИ ОТМЕНИ: ошибка геопозиции:",
        error
      );

    }

  }
);


// ============================================================
// КОНЕЦ БЛОКА «ПУНКТЫ ОТМЕНЫ»
// ============================================================
// 💰 ФИНАЛЬНЫЙ БЛОК ЗАРАБОТКА
//
// 🟡 Glovo
// 🟢 Bolt
// 🔴 iPOST
// 🚨 Bolt TR
// 👤 Личные доставки
// 🏢 Этажи
// ☕ Чаевые
// 🎯 Квесты
//
// Команды:
//
// Гл 500
// Болт 500
// П+ 500
// Т 500
//
// Л 500
// Л 30.09.2026 500
//
// КВЕ 500
// КВЕ 30.09.2026 500
//
// Э 150
// Э 150 30.09.2026
// Э 30.09.2026 150
//
// Мой день
// Топ день
// Топ день 30.09.2026
//
// Моя неделя
// Топ неделя
//
// Мой месяц
// Топ месяц
//
// Топ чай
// Топ чай неделя
// Топ чай месяц
//
// Цель наз неделя 10000
// Цель наз месяц 50000
//
// /ob Имя Дата
// ============================================================


const FINAL_EARNINGS_COLLECTION =
  "courier-earnings-v1";

const FINAL_EARNINGS_KEY =
  "main";


// ============================================================
// ЗАГРУЗКА
// ============================================================

async function finalEarningsLoad() {

  const collection =
    db.collection(
      FINAL_EARNINGS_COLLECTION
    );

  const doc =
    await collection.findOne({
      key:
        FINAL_EARNINGS_KEY
    });

  if (!doc || !doc.data) {

    const state = {
      users: {},
      days: {},
      goals: {
        week: {},
        month: {}
      },
      goalHistory: {
        week: {},
        month: {}
      },
      goalNotified: {
        week: {},
        month: {}
      },
      goalReportChatId:
        null
    };

    await collection.updateOne(
      {
        key:
          FINAL_EARNINGS_KEY
      },
      {
        $set: {
          key:
            FINAL_EARNINGS_KEY,

          data:
            state,

          updatedAt:
            Date.now()
        }
      },
      {
        upsert:
          true
      }
    );

    return state;
  }

  const state =
    doc.data;

  if (!state.users) {
    state.users = {};
  }

  if (!state.days) {
    state.days = {};
  }

  if (!state.goals) {
    state.goals = {};
  }

  if (!state.goals.week) {
    state.goals.week = {};
  }

  if (!state.goals.month) {
    state.goals.month = {};
  }

  if (!state.goalHistory) {
    state.goalHistory = {};
  }

  if (!state.goalHistory.week) {
    state.goalHistory.week = {};
  }

  if (!state.goalHistory.month) {
    state.goalHistory.month = {};
  }

  if (!state.goalNotified) {
    state.goalNotified = {};
  }

  if (!state.goalNotified.week) {
    state.goalNotified.week = {};
  }

  if (!state.goalNotified.month) {
    state.goalNotified.month = {};
  }

  if (
    typeof state.goalReportChatId ===
    "undefined"
  ) {
    state.goalReportChatId =
      null;
  }

  return state;
}


// ============================================================
// СОХРАНЕНИЕ
// ============================================================

async function finalEarningsSave(
  state
) {

  const collection =
    db.collection(
      FINAL_EARNINGS_COLLECTION
    );

  await collection.updateOne(
    {
      key:
        FINAL_EARNINGS_KEY
    },
    {
      $set: {
        key:
          FINAL_EARNINGS_KEY,

        data:
          state,

        updatedAt:
          Date.now()
      }
    },
    {
      upsert:
        true
    }
  );
}


// ============================================================
// СЕГОДНЯ
// ============================================================

function finalEarningsToday() {

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:
        TIMEZONE,

      day:
        "2-digit",

      month:
        "2-digit",

      year:
        "numeric"
    }
  ).format(
    new Date()
  );
}


// ============================================================
// РАЗБОР ДАТЫ
//
// Поддерживает:
//
// 30.09.2026
// 30/09/2026
// 2026-09-30
// ============================================================

function finalEarningsParseDate(
  value
) {

  const text =
    String(
      value || ""
    ).trim();

  let match;


  match =
    text.match(
      /^(\d{2})[./](\d{2})[./](\d{4})$/
    );

  if (match) {

    const day =
      Number(
        match[1]
      );

    const month =
      Number(
        match[2]
      );

    const year =
      Number(
        match[3]
      );

    const date =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      );

    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date;
    }

    return null;
  }


  match =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (match) {

    const year =
      Number(
        match[1]
      );

    const month =
      Number(
        match[2]
      );

    const day =
      Number(
        match[3]
      );

    const date =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      );

    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date;
    }
  }

  return null;
}


// ============================================================
// ДАТА DD.MM.YYYY
// ============================================================

function finalEarningsDotDate(
  date
) {

  return (
    String(
      date.getUTCDate()
    ).padStart(2, "0") +

    "." +

    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0") +

    "." +

    date.getUTCFullYear()
  );
}


// ============================================================
// ДАТА DD/MM/YYYY
// ============================================================

function finalEarningsSlashDate(
  date
) {

  return (
    String(
      date.getUTCDate()
    ).padStart(2, "0") +

    "/" +

    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0") +

    "/" +

    date.getUTCFullYear()
  );
}


// ============================================================
// ДАТА YYYY-MM-DD
// ============================================================

function finalEarningsISODate(
  date
) {

  return (
    date.getUTCFullYear() +

    "-" +

    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0") +

    "-" +

    String(
      date.getUTCDate()
    ).padStart(2, "0")
  );
}


// ============================================================
// ВАРИАНТЫ ДАТЫ
// ============================================================

function finalEarningsDateVariants(
  dateKey
) {

  const date =
    finalEarningsParseDate(
      dateKey
    );

  if (!date) {
    return [];
  }

  return [
    finalEarningsSlashDate(date),
    finalEarningsDotDate(date),
    finalEarningsISODate(date)
  ];
}


// ============================================================
// ПОИСК ДНЯ
// ============================================================

function finalEarningsFindDay(
  state,
  dateKey
) {

  if (
    !state ||
    !state.days
  ) {
    return null;
  }

  const variants =
    finalEarningsDateVariants(
      dateKey
    );

  for (
    const key
    of variants
  ) {

    if (
      state.days[key]
    ) {
      return state.days[key];
    }
  }

  return null;
}


// ============================================================
// ПОЛЬЗОВАТЕЛЬ
// ============================================================

function finalEarningsGetUserId(
  state,
  ctx
) {

  const userId =
    String(
      ctx.from.id
    );

  const name =
    getTelegramDisplayName(
      ctx
    );

  if (
    !state.users[userId]
  ) {

    state.users[userId] = {

      name:
        name,

      username:
        ctx.from.username ||
        ""
    };

  } else {

    state.users[userId].name =
      name;

    if (
      ctx.from.username
    ) {

      state.users[userId].username =
        ctx.from.username;
    }
  }

  return userId;
}


// ============================================================
// СОЗДАНИЕ ДНЯ / ПОЛЬЗОВАТЕЛЯ
// ============================================================

function finalEarningsEnsureItem(
  state,
  dateKey,
  userId,
  ctx
) {

  if (
    !state.days[dateKey]
  ) {
    state.days[dateKey] = {};
  }

  if (
    !state.days[dateKey][userId]
  ) {

    state.days[dateKey][userId] = {

      name:
        state.users[userId]?.name ||
        getTelegramDisplayName(ctx),

      username:
        state.users[userId]?.username ||
        ctx.from.username ||
        "",

      glovo:
        0,

      bolt:
        0,

      ipost:
        0,

      bolttr:
        0,

      personal:
        0,

      quests:
        0,

      floors:
        0
    };
  }

  const item =
    state.days[dateKey][userId];

  item.name =
    item.name ||
    state.users[userId]?.name ||
    getTelegramDisplayName(ctx);

  item.glovo =
    Number(item.glovo) || 0;

  item.bolt =
    Number(item.bolt) || 0;

  item.ipost =
    Number(item.ipost) ||
    Number(item.iposr) ||
    0;

  item.bolttr =
    Number(item.bolttr) || 0;

  item.personal =
    Number(item.personal) || 0;

  item.quests =
    Number(item.quests) || 0;

  item.floors =
    Number(item.floors) || 0;

  return item;
}


// ============================================================
// ОКРУГЛЕНИЕ
// ============================================================

function finalEarningsRound(
  value
) {

  return Math.round(
    (
      Number(value) || 0
    ) * 100
  ) / 100;
}


// ============================================================
// СУММА
// ============================================================

function finalEarningsAmount(
  value
) {

  const number =
    Number(
      String(
        value
      ).replace(
        ",",
        "."
      )
    );

  if (
    !Number.isFinite(number) ||
    !Number.isInteger(number)
  ) {
    return NaN;
  }

  return number;
}


// ============================================================
// ДОБАВЛЕНИЕ ОСНОВНОГО ЗАРАБОТКА
// ============================================================

async function finalEarningsAdd(
  ctx,
  type,
  amount,
  dateInput
) {

  try {

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {

      await ctx.reply(
        "❌ Сумма должна быть целым числом больше 0 грн."
      );

      return;
    }

    const targetDate =
      dateInput ||
      finalEarningsToday();

    const parsed =
      finalEarningsParseDate(
        targetDate
      );

    if (!parsed) {

      await ctx.reply(
        "❌ Неверная дата."
      );

      return;
    }

    const dateKey =
      finalEarningsSlashDate(
        parsed
      );

    const state =
      await finalEarningsLoad();

    const userId =
      finalEarningsGetUserId(
        state,
        ctx
      );

    const item =
      finalEarningsEnsureItem(
        state,
        dateKey,
        userId,
        ctx
      );

    if (
      ![
        "glovo",
        "bolt",
        "ipost",
        "bolttr"
      ].includes(type)
    ) {

      await ctx.reply(
        "❌ Неизвестная категория."
      );

      return;
    }

    item[type] =
      finalEarningsRound(
        (
          Number(
            item[type]
          ) || 0
        ) + amount
      );

    await finalEarningsSave(
      state
    );

    const todayKey = finalEarningsToday();
    if (finalEarningsISODate(parsed) === finalEarningsISODate(finalEarningsParseDate(todayKey))) {
      await finalEarningsCheckGoal(ctx, userId, "week");
      await finalEarningsCheckGoal(ctx, userId, "month");
    }

    let title =
      "💰 Заработок";

    if (
      type === "glovo"
    ) {
      title =
        "🟡 Glovo";
    }

    if (
      type === "bolt"
    ) {
      title =
        "🟢 Bolt";
    }

    if (
      type === "ipost"
    ) {
      title =
        "🔴 iPOST";
    }

    if (
      type === "bolttr"
    ) {
      title =
        "🚨 Bolt TR";
    }

    await ctx.reply(
      `${title} +${amount} грн\n` +
      `📅 ${finalEarningsDotDate(parsed)}`
    );

  } catch (error) {

    console.error(
      "FINAL EARNINGS ADD ERROR:",
      error
    );

    await ctx.reply(
      "❌ Ошибка добавления заработка."
    );
  }
}


// ============================================================
// ИСТОРИЧЕСКИЕ ЗАПИСИ И ПАКЕТНЫЙ ВВОД
// Формат каждой строки: Г 20.10.2026 100
// Можно прислать несколько строк одним сообщением.
// ============================================================

bot.hears(
  /^(?:(?:гл|г|болт|б|п\+|а|т|л|к|э)\s+\d{2}[./]\d{2}[./]\d{4}\s+\d+(?:[.,]\d+)?(?:\r?\n|$))+$/i,
  async ctx => {
    const lines = String(ctx.message.text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const parsed = [];
    const errors = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(гл|г|болт|б|п\+|а|т|л|к|э)\s+(\d{2}[./]\d{2}[./]\d{4})\s+(\d+(?:[.,]\d+)?)$/i);
      if (!m) { errors.push("Строка " + (i + 1) + ": неверный формат"); continue; }
      const typeWord = m[1].toLowerCase();
      const amount = Number(m[3].replace(",", "."));
      if (!Number.isInteger(amount) || amount <= 0) {
        errors.push("Строка " + (i + 1) + ": сумма должна быть целым числом больше 0");
        continue;
      }
      const type = /^(гл|г)$/.test(typeWord) ? "glovo"
        : /^(болт|б)$/.test(typeWord) ? "bolt"
        : /^(п\+|а)$/.test(typeWord) ? "ipost"
        : typeWord === "т" ? "bolttr"
        : typeWord === "э" ? "floors"
        : typeWord === "л" ? "personal" : "quests";
      const date = finalEarningsParseDate(m[2]);
      if (!date) { errors.push("Строка " + (i + 1) + ": неверная дата"); continue; }
      parsed.push({ type, amount, date: m[2] });
    }
    if (!parsed.length) {
      await ctx.reply("❌ Не нашёл корректных строк. Пример:\nГ 20.10.2026 100\nГ 21.10.2026 200");
      return;
    }
    let added = 0;
    for (const row of parsed) {
      if (row.type === "personal" || row.type === "quests" || row.type === "floors") {
        await finalEarningsAddExtra(ctx, row.type, row.amount, row.date);
      } else {
        await finalEarningsAdd(ctx, row.type, row.amount, row.date);
      }
      added++;
    }
    if (errors.length) await ctx.reply("⚠️ Пропущенные строки:\n" + errors.join("\n"));
    if (added > 1) await ctx.reply("✅ Обработано исторических записей: " + added + ". Проверь ответы выше и отчёты по датам.");
  }
);

// ============================================================
// ОСНОВНЫЕ КОМАНДЫ
//
// Поддерживаются варианты:
// Гл 500 / Г 500
// Болт 500 / Б 500
// П+ 500 / А 500
// Т 500
// А также дата ПОСЛЕ суммы:
// Гл 500 30.09.2026
// Г 500 30/09/2026
// Б 500 2026-09-30
// ============================================================

function finalEarningsRegisterMainCommand(regex, type) {
  bot.hears(regex, async ctx => {
    const amount = finalEarningsAmount(ctx.match[1]);
    const date = ctx.match[2] || finalEarningsToday();
    await finalEarningsAdd(ctx, type, amount, date);
  });
}

finalEarningsRegisterMainCommand(
  /^(?:гл|г)\s+(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  "glovo"
);

finalEarningsRegisterMainCommand(
  /^(?:болт|б)\s+(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  "bolt"
);

finalEarningsRegisterMainCommand(
  /^(?:п\+|а)\s*(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  "ipost"
);

finalEarningsRegisterMainCommand(
  /^т\s+(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  "bolttr"
);


// ============================================================
// 👤 ЛИЧНЫЕ ДОСТАВКИ
//
// Л 500
// Л 30.09.2026 500
// ============================================================

async function finalEarningsAddExtra(
  ctx,
  type,
  amount,
  dateInput
) {

  try {

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {

      await ctx.reply(
        "❌ Сумма должна быть целым числом больше 0 грн."
      );

      return;
    }

    const parsed =
      finalEarningsParseDate(
        dateInput
      );

    if (!parsed) {

      await ctx.reply(
        "❌ Неверная дата."
      );

      return;
    }

    const state =
      await finalEarningsLoad();

    const userId =
      finalEarningsGetUserId(
        state,
        ctx
      );

    const dateKey =
      finalEarningsSlashDate(
        parsed
      );

    const item =
      finalEarningsEnsureItem(
        state,
        dateKey,
        userId,
        ctx
      );

    item[type] =
      finalEarningsRound(
        (
          Number(
            item[type]
          ) || 0
        ) + amount
      );

    await finalEarningsSave(
      state
    );

    const todayKey = finalEarningsToday();
    if (finalEarningsISODate(parsed) === finalEarningsISODate(finalEarningsParseDate(todayKey))) {
      await finalEarningsCheckGoal(ctx, userId, "week");
      await finalEarningsCheckGoal(ctx, userId, "month");
    }

    await ctx.reply(
      (
        type === "personal"
          ? "👤 Личные доставки"
          : type === "floors"
            ? "🏢 Этажи"
            : "🎯 Квесты"
      ) +
      ` +${amount} грн\n` +
      `📅 ${finalEarningsDotDate(parsed)}`
    );

  } catch (error) {

    console.error(
      "EXTRA EARNINGS ERROR:",
      error
    );

    await ctx.reply(
      "❌ Ошибка добавления."
    );
  }
}


bot.hears(
  /^л\s+(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  async ctx => {
    await finalEarningsAddExtra(
      ctx,
      "personal",
      finalEarningsAmount(ctx.match[1]),
      ctx.match[2] || finalEarningsToday()
    );
  }
);


// ============================================================
// 🎯 КВЕСТЫ
//
// КВЕ 500
// КВЕ 30.09.2026 500
// ============================================================

bot.hears(
  /^кве\s+(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  async ctx => {
    await finalEarningsAddExtra(
      ctx,
      "quests",
      finalEarningsAmount(ctx.match[1]),
      ctx.match[2] || finalEarningsToday()
    );
  }
);

// Формат с датой перед суммой: КВЕ 30.09.2026 500
bot.hears(
  /^кве\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2})\s+(\d+(?:[.,]\d+)?)$/i,
  async ctx => {
    await finalEarningsAddExtra(
      ctx,
      "quests",
      finalEarningsAmount(ctx.match[2]),
      ctx.match[1]
    );
  }
);


bot.hears(
  /^э\s+(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  async ctx => {
    await finalEarningsAddExtra(ctx, "floors", finalEarningsAmount(ctx.match[1]), ctx.match[2] || finalEarningsToday());
  }
);

// ============================================================
// 📅 НЕДЕЛЯ / МЕСЯЦ
// ============================================================

function finalEarningsWeekKey(
  date
) {

  const day =
    date.getUTCDay();

  const diff =
    day === 0
      ? -6
      : 1 - day;

  const monday =
    new Date(date);

  monday.setUTCDate(
    monday.getUTCDate() +
    diff
  );

  return finalEarningsISODate(
    monday
  );
}


function finalEarningsMonthKey(
  date
) {

  return (
    date.getUTCFullYear() +
    "-" +
    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0")
  );
}


function finalEarningsCurrentPeriod(
  period
) {

  const date =
    finalEarningsParseDate(
      finalEarningsToday()
    );

  if (!date) {
    return null;
  }

  return period === "week"
    ? finalEarningsWeekKey(date)
    : finalEarningsMonthKey(date);
}


// ============================================================
// ☕ ЧАЕВЫЕ ЗА ДЕНЬ
// ============================================================

async function finalEarningsTeaForDate(
  dateKey
) {

  const parsed =
    finalEarningsParseDate(
      dateKey
    );

  if (!parsed) {
    return {};
  }

  const targetISO =
    finalEarningsISODate(
      parsed
    );

  const tipsState =
    await loadTipsState();

  await ensureTipsDay(
    tipsState
  );

  const result = {};

  function addEntries(
    entries
  ) {

    for (
      const [
        userId,
        item
      ] of Object.entries(
        entries || {}
      )
    ) {

      if (!item) {
        continue;
      }

      const id =
        String(userId);

      if (!result[id]) {

        result[id] = {
          name:
            item.name ||
            "Неизвестный",

          amount:
            0
        };
      }

      if (item.name) {

        result[id].name =
          item.name;
      }

      result[id].amount +=
        Number(
          item.amount
        ) || 0;
    }
  }


  if (
    String(
      tipsState.currentDate
    ) === targetISO
  ) {

    addEntries(
      tipsState.today
    );
  }


  for (
    const day
    of tipsState.archive || []
  ) {

    if (
      !day ||
      !day.date
    ) {
      continue;
    }

    const archiveDate =
      finalEarningsParseDate(
        day.date
      );

    if (!archiveDate) {
      continue;
    }

    if (
      finalEarningsISODate(
        archiveDate
      ) === targetISO
    ) {

      addEntries(
        day.tips
      );
    }
  }

  return result;
}


// ============================================================
// 📊 РАСЧЁТ ОДНОГО ДНЯ
// ============================================================

async function finalEarningsReport(
  userId,
  dateKey
) {

  const state =
    await finalEarningsLoad();

  const day =
    finalEarningsFindDay(
      state,
      dateKey
    ) || {};

  const id =
    String(userId);

  const item =
    day[id] || {};

  const glovo =
    Number(item.glovo) || 0;

  const bolt =
    Number(item.bolt) || 0;

  const ipost =
    Number(item.ipost) ||
    Number(item.iposr) ||
    0;

  const bolttr =
    Number(item.bolttr) || 0;

  const personal =
    Number(item.personal) || 0;

  const floors =
    Number(item.floors) || 0;

  const teaData =
    await finalEarningsTeaForDate(
      dateKey
    );

  const teaItem =
    teaData[id];

  const tea =
    teaItem
      ? Number(
        teaItem.amount
      ) || 0
      : 0;

  const name =
    item.name ||
    teaItem?.name ||
    state.users?.[id]?.name ||
    "Неизвестный";

  return {

    userId:
      id,

    name,

    glovo,

    bolt,

    ipost,

    bolttr,

    personal,

    floors,

    tea,

    quests:
      0,

    total:
      glovo +
      bolt +
      ipost +
      bolttr +
      personal +
      floors +
      tea
  };
}


// ============================================================
// 💰 МОЙ ДЕНЬ
// ============================================================

function v3EscapeSvg(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"
  }[char]));
}

async function v3BuildMyDayCard(report, dateText, rankText, goalTarget) {
  const sharp = __globovetsSharp;
  const width = 1200, height = 1500;
  const safe = v3EscapeSvg;
  const rows = [
    ["GLOVO", report.glovo, "#f6c94b"],
    ["BOLT", report.bolt, "#65d48b"],
    ["IPOST", report.ipost, "#f16c6c"],
    ["BOLT TR", report.bolttr, "#ff934d"],
    ["ЛИЧНЫЕ ДОСТАВКИ", report.personal, "#d5d5d5"],
    ["ЭТАЖИ", report.floors, "#d5d5d5"],
    ["ЧАЕВЫЕ", report.tea, "#e7b7ff"]
  ];
  const rowSvg = rows.map((item,index) => {
    const y = 690 + index * 82;
    return '<text x="104" y="'+y+'" fill="#bdbdbd" font-size="30" font-weight="600">'+safe(item[0])+'</text>'+
      '<text x="1090" y="'+y+'" fill="'+item[2]+'" font-size="34" font-weight="700" text-anchor="end">'+safe(item[1])+' ₴</text>';
  }).join("");
  const goal = Number(goalTarget) > 0 ? Number(goalTarget) : 0;
  const percent = goal ? Math.round(Number(report.total || 0) / goal * 100) : 0;
  const progress = goal ? Math.max(0,Math.min(100,percent)) : 0;
  const goalSvg = goal
    ? '<text x="104" y="1330" fill="#f3c84b" font-size="30" font-weight="700">ЦЕЛЬ ДНЯ — '+safe(goal)+' ₴</text>'+
      '<text x="1090" y="1330" fill="#ffffff" font-size="30" font-weight="700" text-anchor="end">'+safe(percent)+'%</text>'+
      '<rect x="104" y="1360" width="986" height="28" rx="14" fill="#343434"/>'+
      '<rect x="104" y="1360" width="'+(986*progress/100)+'" height="28" rx="14" fill="#38c878"/>'
    : '<text x="104" y="1340" fill="#a7a7a7" font-size="28">ЦЕЛЬ ДНЯ НЕ УСТАНОВЛЕНА</text>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'">'+
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#080909"/><stop offset="1" stop-color="#1b1b18"/></linearGradient>'+
    '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9c7625"/><stop offset=".5" stop-color="#ffe17a"/><stop offset="1" stop-color="#9c7625"/></linearGradient></defs>'+
    '<rect width="1200" height="1500" fill="url(#bg)"/>'+
    '<path d="M0 0H1200V18H0Z" fill="url(#gold)"/><path d="M0 1482H1200V1500H0Z" fill="url(#gold)"/>'+
    '<rect x="42" y="42" width="1116" height="1416" rx="34" fill="none" stroke="#9d7b2d" stroke-width="3"/>'+
    '<text x="104" y="145" fill="#f5d36a" font-size="34" font-weight="800" letter-spacing="8">GLOBOVETS • МОТОКУРЬЕР</text>'+
    '<text x="104" y="270" fill="#ffffff" font-size="76" font-weight="900">'+safe(report.name || "Курьер")+'</text>'+
    '<text x="104" y="335" fill="#bdbdbd" font-size="34">'+safe(dateText)+'</text>'+
    '<rect x="104" y="390" width="500" height="68" rx="34" fill="#29251a" stroke="#a88636" stroke-width="2"/>'+
    '<text x="354" y="435" fill="#f5d36a" font-size="28" font-weight="800" text-anchor="middle">'+safe(rankText || "КУРЬЕР")+'</text>'+
    '<text x="104" y="565" fill="#bdbdbd" font-size="28" letter-spacing="5">ЗАРАБОТОК ЗА ДЕНЬ</text>'+
    '<text x="104" y="650" fill="#f7d56e" font-size="86" font-weight="900">'+safe(report.total)+' ₴</text>'+
    '<path d="M104 660H1090" stroke="#80652b" stroke-width="2"/>'+
    rowSvg+
    '<path d="M104 1270H1090" stroke="#80652b" stroke-width="2"/>'+
    goalSvg+
    '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

bot.hears(
  /^мой день$/i,
  async ctx => {
    try {
      const userId = String(ctx.from.id);
      const dateKey = finalEarningsToday();
      const report = await finalEarningsReport(userId,dateKey);
      const state = await v3LoadEarningsState();
      const dailyGoal = state.goals?.day?.[userId];
      const goalTarget = dailyGoal?.dateKey === v3DateISO(dateKey) ? Number(dailyGoal.target)||0 : 0;
      const titleEntry = Object.entries(state.titles || {}).find(([,title]) =>
        (title.holders || []).some(holder => String(holder.userId) === userId)
      );
      const titleMeta = titleEntry ? V3_TITLES.find(title => title.id === titleEntry[0]) : null;
      const rankText = titleMeta?.name || "КУРЬЕР НА ЛИНИИ";
      const dateText = finalEarningsDotDate(finalEarningsParseDate(dateKey));
      const percent = goalTarget > 0 ? Math.round(report.total / goalTarget * 100) : 0;
      try {
        const png = await v3BuildMyDayCard(report,dateText,rankText,goalTarget);
        await ctx.replyWithPhoto({source:png},{
          caption:"💰 МОЙ ДЕНЬ • "+report.name+"\n📅 "+dateText+"\n🎯 Цель: "+(goalTarget ? goalTarget+" грн ("+percent+"%)" : "не установлена")
        });
      } catch (imageError) {
        console.error("MY DAY CARD ERROR:",imageError);
        await ctx.reply(
          "💰 МОЙ ДЕНЬ\n📅 "+dateText+"\n👑 "+rankText+"\n\n"+
          "🟡 Glovo — "+report.glovo+" грн\n"+
          "🟢 Bolt — "+report.bolt+" грн\n"+
          "🔴 iPOST — "+report.ipost+" грн\n"+
          "🚨 Bolt TR — "+report.bolttr+" грн\n"+
          "👤 Личные доставки — "+report.personal+" грн\n"+
          "🏢 Этажи — "+report.floors+" грн\n"+
          "☕ Чаевые — "+report.tea+" грн\n\n"+
          "💰 ИТОГО — "+report.total+" грн"+
          (goalTarget ? "\n🎯 Цель дня — "+goalTarget+" грн ("+percent+"%)" : "")
        );
      }
    } catch (error) {
      console.error("MY DAY ERROR:",error);
      await ctx.reply("❌ Ошибка формирования моего дня.");
    }
  }
);


// ============================================================
// 🏆 ТОП ДЕНЬ
// ============================================================

async function finalEarningsBuildDay(
  dateKey
) {

  const state =
    await finalEarningsLoad();

  const day =
    finalEarningsFindDay(
      state,
      dateKey
    ) || {};

  const tea =
    await finalEarningsTeaForDate(
      dateKey
    );

  const ids =
    new Set();

  Object.keys(
    day
  ).forEach(
    id =>
      ids.add(
        String(id)
      )
  );

  Object.keys(
    tea
  ).forEach(
    id =>
      ids.add(
        String(id)
      )
  );

  const result = [];

  for (
    const id
    of ids
  ) {

    const report =
      await finalEarningsReport(
        id,
        dateKey
      );

    if (
      report.total > 0
    ) {

      result.push(
        report
      );
    }
  }

  result.sort(
    (
      a,
      b
    ) =>
      b.total -
      a.total
  );

  return result;
}


async function finalEarningsShowDay(
  ctx,
  dateKey
) {

  try {

    const parsed =
      finalEarningsParseDate(
        dateKey
      );

    if (!parsed) {

      await ctx.reply(
        "❌ Неверная дата.\n\n" +
        "Пример:\n" +
        "Топ день 30.09.2026"
      );

      return;
    }

    const entries =
      await finalEarningsBuildDay(
        dateKey
      );
    const dailyGoalState = await v3LoadEarningsState();
    const goalDateKey = v3DateISO(dateKey);

    let text =
      "🏆 ТОП ДЕНЬ\n" +
      `📅 ${finalEarningsDotDate(parsed)}\n` +
      "━━━━━━━━━━━━━━\n\n";

    if (
      entries.length === 0
    ) {

      text +=
        "За этот день данных нет.";

    } else {

      for (const [index, item] of entries.entries()) {
        text +=
          `${index + 1}. ${item.name}\n` +
          `🟡 ${item.glovo} | ` +
          `🟢 ${item.bolt} | ` +
          `🔴 ${item.ipost} | ` +
          `🚨 ${item.bolttr} | ` +
          `👤 ${item.personal} | ` +
          `☕ ${item.tea}\n` +
          `🏢 Этажи — ${item.floors} грн\n` +
          `💰 Итого: ${item.total} грн\n`;
        const goal = dailyGoalState.goals.day[String(item.userId)];
        if (goal?.dateKey === goalDateKey) {
          text += "🎯 Цель дня: " + goal.target + " грн (" + Math.round(item.total / goal.target * 100) + "%)\n";
        }
      }
    }

    await ctx.reply(
      text
    );

  } catch (error) {

    console.error(
      "TOP DAY ERROR:",
      error
    );

    await ctx.reply(
      "❌ Ошибка формирования топа дня."
    );
  }
}


bot.hears(
  /^топ день$/i,
  async ctx => {

    await finalEarningsShowDay(
      ctx,
      finalEarningsToday()
    );
  }
);


bot.hears(
  /^топ день\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2})$/i,
  async ctx => {

    await finalEarningsShowDay(
      ctx,
      ctx.match[1]
    );
  }
);


// ============================================================
// 📊 ДАННЫЕ ЗА НЕДЕЛЮ / МЕСЯЦ
// ============================================================

async function finalEarningsPeriodEntries(
  period
) {

  const state =
    await finalEarningsLoad();

  const tipsState =
    await loadTipsState();

  await ensureTipsDay(
    tipsState
  );

  const now =
    finalEarningsParseDate(
      finalEarningsToday()
    );

  const currentKey =
    period === "week"
      ? finalEarningsWeekKey(now)
      : finalEarningsMonthKey(now);

  const totals = {};


  function add(
    id,
    name,
    glovo,
    bolt,
    ipost,
    bolttr,
    personal,
    quests,
    floors,
    tea
  ) {

    id =
      String(id);

    if (!totals[id]) {

      totals[id] = {

        userId:
          id,

        name:
          name ||
          "Неизвестный",

        glovo:
          0,

        bolt:
          0,

        ipost:
          0,

        bolttr:
          0,

        personal:
          0,

        quests:
          0,

        floors:
          0,

        tea:
          0
      };
    }

    if (name) {

      totals[id].name =
        name;
    }

    totals[id].glovo +=
      Number(glovo) || 0;

    totals[id].bolt +=
      Number(bolt) || 0;

    totals[id].ipost +=
      Number(ipost) || 0;

    totals[id].bolttr +=
      Number(bolttr) || 0;

    totals[id].personal +=
      Number(personal) || 0;

    totals[id].quests +=
      Number(quests) || 0;

    totals[id].floors +=
      Number(floors) || 0;

    totals[id].tea +=
      Number(tea) || 0;
  }


  // ----------------------------------------------------------
  // ЗАРАБОТОК
  // ----------------------------------------------------------

  for (
    const [
      dateKey,
      day
    ] of Object.entries(
      state.days || {}
    )
  ) {

    const parsed =
      finalEarningsParseDate(
        dateKey
      );

    if (!parsed) {
      continue;
    }

    const key =
      period === "week"
        ? finalEarningsWeekKey(
          parsed
        )
        : finalEarningsMonthKey(
          parsed
        );

    if (
      key !== currentKey
    ) {
      continue;
    }

    for (
      const [
        id,
        item
      ] of Object.entries(
        day || {}
      )
    ) {

      if (!item) {
        continue;
      }

      add(

        id,

        item.name ||
        state.users?.[id]?.name ||
        "Неизвестный",

        item.glovo,

        item.bolt,

        Number(item.ipost) ||
        Number(item.iposr) ||
        0,

        item.bolttr,

        item.personal,

        item.quests,

        item.floors,

        0
      );
    }
  }


  // ----------------------------------------------------------
  // ЧАЕВЫЕ
  // ----------------------------------------------------------

  const tipDays = [];

  if (
    tipsState.currentDate
  ) {

    tipDays.push({
      date:
        tipsState.currentDate,

      tips:
        tipsState.today || {}
    });
  }

  for (
    const day
    of tipsState.archive || []
  ) {

    if (
      day &&
      day.date
    ) {

      tipDays.push(
        day
      );
    }
  }


  for (
    const day
    of tipDays
  ) {

    const parsed =
      finalEarningsParseDate(
        day.date
      );

    if (!parsed) {
      continue;
    }

    const key =
      period === "week"
        ? finalEarningsWeekKey(
          parsed
        )
        : finalEarningsMonthKey(
          parsed
        );

    if (
      key !== currentKey
    ) {
      continue;
    }

    for (
      const [
        id,
        item
      ] of Object.entries(
        day.tips || {}
      )
    ) {

      if (!item) {
        continue;
      }

      add(
        id,

        item.name ||
        "Неизвестный",

        0,
        0,
        0,
        0,
        0,
        0,
        0,

        Number(
          item.amount
        ) || 0
      );
    }
  }


  const result =
    Object.values(
      totals
    )
      .map(
        item => ({

          ...item,

          total:
            item.glovo +
            item.bolt +
            item.ipost +
            item.bolttr +
            item.personal +
            item.quests +
            item.floors +
            item.tea
        })
      )
      .filter(
        item =>
          item.total > 0 ||
          state.goals?.[period]?.[
            item.userId
          ]?.target > 0
      )
      .sort(
        (
          a,
          b
        ) =>
          b.total -
          a.total
      );

  return {
    result,
    state,
    currentKey
  };
}
// ============================================================
// 🎯 ЦЕЛИ
// ============================================================

function finalEarningsGoalPercent(
  total,
  target
) {

  if (
    !(target > 0)
  ) {
    return 0;
  }

  return Math.round(
    (
      Number(total) /
      Number(target)
    ) * 100
  );
}


// ============================================================
// УСТАНОВКА ЦЕЛИ
// ============================================================

async function finalEarningsSetGoal(
  ctx,
  period,
  amount
) {

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    await ctx.reply(
      "❌ Сумма цели должна быть больше 0 грн."
    );

    return;
  }

  const state =
    await finalEarningsLoad();

  const userId =
    finalEarningsGetUserId(
      state,
      ctx
    );

  const periodKey =
    finalEarningsCurrentPeriod(
      period
    );

  state.goals[period][userId] = {

    periodKey:

      periodKey,

    target:

      finalEarningsRound(
        amount
      ),

    notified:
      false
  };

  if (
    ctx.chat?.id
  ) {

    state.goalReportChatId =
      ctx.chat.id;
  }

  await finalEarningsSave(
    state
  );

  await ctx.reply(

    `🎯 Цель ${period === "week"
      ? "недели"
      : "месяца"
    } установлена\n\n` +

    `💰 ${finalEarningsRound(amount)} грн`
  );
}


// ============================================================
// ЦЕЛЬ НЕДЕЛИ
// ============================================================

bot.hears(
  /^цель\s+наз\s+неделя\s+(\d+(?:[.,]\d+)?)$/i,
  async ctx => {

    await finalEarningsSetGoal(
      ctx,
      "week",
      finalEarningsAmount(
        ctx.match[1]
      )
    );
  }
);


// ============================================================
// ЦЕЛЬ МЕСЯЦА
// ============================================================

bot.hears(
  /^цель\s+наз\s+месяц\s+(\d+(?:[.,]\d+)?)$/i,
  async ctx => {

    await finalEarningsSetGoal(
      ctx,
      "month",
      finalEarningsAmount(
        ctx.match[1]
      )
    );
  }
);


// ============================================================
// ПРОВЕРКА ЦЕЛИ
// ============================================================

async function finalEarningsCheckGoal(
  ctx,
  userId,
  period
) {

  try {

    const data =
      await finalEarningsPeriodEntries(
        period
      );

    const item =
      data.result.find(
        x =>
          String(
            x.userId
          ) ===
          String(
            userId
          )
      );

    const goal =
      data.state.goals?.[
      period
      ]?.[
      String(userId)
      ];

    if (
      !goal ||
      goal.periodKey !==
      data.currentKey ||
      !(goal.target > 0)
    ) {

      return;
    }

    const total =
      item?.total || 0;

    const percent =
      finalEarningsGoalPercent(
        total,
        goal.target
      );

    if (
      percent >= 100 &&
      !goal.notified
    ) {

      goal.notified =
        true;

      data.state.goalNotified[
        period
      ][
        data.currentKey
      ] =
        data.state.goalNotified[
        period
        ][
        data.currentKey
        ] || {};

      data.state.goalNotified[
        period
      ][
        data.currentKey
      ][
        String(userId)
      ] =
        true;

      await finalEarningsSave(
        data.state
      );

      const label =
        period === "week"
          ? "НЕДЕЛИ"
          : "МЕСЯЦА";

      await ctx.reply(

        `🎉🎯 ЦЕЛЬ ${label} ВЫПОЛНЕНА!\n\n` +

        `👤 ${item?.name ||
        data.state.users?.[
          userId
        ]?.name ||
        "Курьер"
        }\n` +

        `💰 Заработано: ${total} грн\n` +

        `🎯 Цель: ${goal.target} грн\n` +

        `📊 Выполнено: ${percent}%\n\n` +

        `🔥 Цель выполнена!`
      );
    }

  } catch (error) {

    console.error(
      "GOAL CHECK ERROR:",
      error
    );
  }
}


// ============================================================
// МОЯ НЕДЕЛЯ / МОЙ МЕСЯЦ
// ============================================================

async function finalEarningsShowPeriod(
  ctx,
  period,
  mode
) {

  try {

    const data =
      await finalEarningsPeriodEntries(
        period
      );

    const userId =
      String(
        ctx.from.id
      );

    const isMine =
      mode === "mine";

    const title =
      period === "week"

        ? (
          isMine
            ? "💰 МОЯ НЕДЕЛЯ"
            : "🏆 ТОП НЕДЕЛЯ"
        )

        : (
          isMine
            ? "💰 МОЙ МЕСЯЦ"
            : "🏆 ТОП МЕСЯЦ"
        );


    // ========================================================
    // МОЙ ПЕРИОД
    // ========================================================

    if (isMine) {

      const mine =
        data.result.find(
          x =>
            String(
              x.userId
            ) ===
            userId
        ) || {

          userId,

          name:
            getTelegramDisplayName(
              ctx
            ),

          glovo:
            0,

          bolt:
            0,

          ipost:
            0,

          bolttr:
            0,

          personal:
            0,

          quests:
            0,

          floors:
            0,

          tea:
            0,

          total:
            0
        };

      const goal =
        data.state.goals?.[
        period
        ]?.[
        userId
        ];

      const target =
        goal?.periodKey ===
          data.currentKey

          ? Number(
            goal.target
          ) || 0

          : 0;

      let text =
        `${title}\n` +
        "━━━━━━━━━━━━━━\n\n";

      text +=
        `🟡 Glovo — ${mine.glovo} грн\n`;

      text +=
        `🟢 Bolt — ${mine.bolt} грн\n`;

      text +=
        `🔴 iPOST — ${mine.ipost} грн\n`;

      text +=
        `🚨 Bolt TR — ${mine.bolttr} грн\n`;

      text +=
        `👤 Личные доставки — ${mine.personal} грн\n`;

      text +=
        `☕ Чаевые — ${mine.tea} грн\n`;

      text +=
        `🏢 Этажи — ${mine.floors} грн\n\n`;

      text +=
        "━━━━━━━━━━━━━━\n";

      text +=
        `🎯 Квесты — ${mine.quests} грн\n\n`;

      text +=
        `💰 ИТОГО — ${mine.total} грн\n`;



      if (
        target > 0
      ) {

        const percent =
          finalEarningsGoalPercent(
            mine.total,
            target
          );

        text +=
          `🎯 Цель ${period === "week"
            ? "недели"
            : "месяца"
          } — ${target} грн\n`;

        text +=
          `📊 Выполнено — ${percent}%\n`;

        if (
          percent >= 100
        ) {

          text +=
            "🏆 ЦЕЛЬ ВЫПОЛНЕНА!";

        } else {

          text +=
            `💵 Осталось — ${finalEarningsRound(
              target -
              mine.total
            )
            } грн`;
        }

      } else {

        text +=
          `🎯 Цель ${period === "week"
            ? "недели"
            : "месяца"
          } не установлена`;
      }

      const average = await v3AverageForPeriod(userId, period, data.currentKey);
      text += "\n📊 Среднее за рабочий день — " + average.average + " грн (" + average.days + " дн.)";
      await ctx.reply(
        text
      );

      return;
    }


    // ========================================================
    // ТОП ПЕРИОДА
    // ========================================================

    let text =
      `${title}\n` +
      "━━━━━━━━━━━━━━\n\n";

    if (
      data.result.length === 0
    ) {

      text +=
        period === "week"
          ? "За эту неделю данных нет."
          : "За этот месяц данных нет.";

    } else {

      for (const [index, item] of data.result.entries()) {
          const goal =
            data.state.goals?.[
            period
            ]?.[
            item.userId
            ];

          const target =
            goal?.periodKey ===
              data.currentKey

              ? Number(
                goal.target
              ) || 0

              : 0;

          text +=
            `${index + 1}. ${item.name}\n`;

          text +=
            `🟡 ${item.glovo} | ` +
            `🟢 ${item.bolt} | ` +
            `🔴 ${item.ipost} | ` +
            `🚨 ${item.bolttr} | ` +
            `👤 ${item.personal} | ` +
            `☕ ${item.tea}\n`;

          text +=
            `🎯 Квесты — ${item.quests}\n`;

          text +=
            `💰 Итого: ${item.total} грн\n`;
          const average = await v3AverageForPeriod(item.userId, period, data.currentKey);
          text += `📊 Среднее/рабочий день: ${average.average} грн (${average.days} дн.)\n`;

          if (
            target > 0
          ) {

            const percent =
              finalEarningsGoalPercent(
                item.total,
                target
              );

            text +=
              `🎯 Цель: ${target} грн\n`;

            text +=
              `📊 Выполнено: ${percent}%\n`;

            if (
              percent >= 100
            ) {

              text +=
                "🏆 ЦЕЛЬ ВЫПОЛНЕНА!\n";

            } else {

              text +=
                `💵 Осталось: ${finalEarningsRound(
                  target -
                  item.total
                )
                } грн\n`;
            }

          } else {

            text +=
              "🎯 Цель: не установлена\n";
          }

          text +=
            "\n";
        }
    }

    await ctx.reply(
      text,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "⬅️ Предыдущая", callback_data: `final_period_prev:${period}:${data.currentKey}:${mode}` },
            { text: "Следующая ➡️", callback_data: `final_period_next:${period}:${data.currentKey}:${mode}` }
          ]]
        }
      }
    );

  } catch (error) {

    console.error(
      "PERIOD REPORT ERROR:",
      error
    );

    await ctx.reply(
      "❌ Ошибка формирования отчёта."
    );
  }
}


// ============================================================
// КОМАНДЫ НЕДЕЛИ / МЕСЯЦА
// ============================================================

bot.hears(
  /^моя неделя$/i,
  async ctx => {

    await finalEarningsShowPeriod(
      ctx,
      "week",
      "mine"
    );
  }
);


bot.hears(
  /^мой неделя$/i,
  async ctx => {

    await finalEarningsShowPeriod(
      ctx,
      "week",
      "mine"
    );
  }
);


bot.hears(
  /^топ неделя$/i,
  async ctx => {

    await finalEarningsShowPeriod(
      ctx,
      "week",
      "top"
    );
  }
);


bot.hears(
  /^мой месяц$/i,
  async ctx => {

    await finalEarningsShowPeriod(
      ctx,
      "month",
      "mine"
    );
  }
);


bot.hears(
  /^моя месяц$/i,
  async ctx => {

    await finalEarningsShowPeriod(
      ctx,
      "month",
      "mine"
    );
  }
);


bot.hears(
  /^топ месяц$/i,
  async ctx => {

    await finalEarningsShowPeriod(
      ctx,
      "month",
      "top"
    );
  }
);


// ============================================================
// НАВИГАЦИЯ НЕДЕЛИ / МЕСЯЦА
// ============================================================

function finalEarningsShiftPeriodKey(period, currentKey, delta) {
  if (period === "week") {
    const d = new Date(currentKey + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta * 7);
    return finalEarningsISODate(d);
  }

  const [y, m] = currentKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function finalEarningsShowPeriodKey(ctx, period, key, mode) {
  const data = await finalEarningsPeriodEntriesForKey(period, key, await finalEarningsLoad());
  const userId = String(ctx.from.id);
  const title = period === "week"
    ? (mode === "mine" ? "💰 МОЯ НЕДЕЛЯ" : "🏆 ТОП НЕДЕЛЯ")
    : (mode === "mine" ? "💰 МОЙ МЕСЯЦ" : "🏆 ТОП МЕСЯЦ");

  let text = `${title}\n📅 ${key}\n━━━━━━━━━━━━━━\n\n`;

  if (mode === "mine") {

    const mine =
      data.find(
        x =>
          String(x.userId) ===
          userId
      ) || {
        glovo: 0,
        bolt: 0,
        ipost: 0,
        bolttr: 0,
        personal: 0,
        tea: 0,
        floors: 0,
        quests: 0,
        total: 0,
        name:
          getTelegramDisplayName(ctx)
      };

    text +=
      `🟡 Glovo — ${mine.glovo} грн\n` +
      `🟢 Bolt — ${mine.bolt} грн\n` +
      `🔴 iPOST — ${mine.ipost} грн\n` +
      `🚨 Bolt TR — ${mine.bolttr} грн\n` +
      `👤 Личные доставки — ${mine.personal} грн\n` +
      `☕ Чаевые — ${mine.tea} грн\n` +
      `🏢 Этажи — ${mine.floors} грн\n` +
      `🎯 Квесты — ${mine.quests} грн\n\n` +
      `💰 ИТОГО — ${mine.total} грн`;
          const average = await v3AverageForPeriod(userId, period, key);
          text += `\n📊 Среднее за рабочий день — ${average.average} грн (${average.days} дн.)`;

  } else if (!data.length) {

    text +=
      "За этот период данных нет.";

  } else {

    data.forEach(
      (
        item,
        i
      ) => {

        text +=
          `${i + 1}. ${item.name}\n` +
          `🟡 ${item.glovo} | ` +
          `🟢 ${item.bolt} | ` +
          `🔴 ${item.ipost} | ` +
          `🚨 ${item.bolttr} | ` +
          `👤 ${item.personal} | ` +
          `☕ ${item.tea} | 🏢 ${item.floors}\n` +
          `🎯 Квесты — ${item.quests}\n` +
          `💰 Итого: ${item.total} грн\n\n`;
      }
    );
  }

  await ctx.editMessageText(
    text,
    {
      reply_markup: {
        inline_keyboard: [[
          {
            text:
              "⬅️ Предыдущая",
            callback_data:
              `final_period_prev:${period}:${key}:${mode}`
          },
          {
            text:
              "Следующая ➡️",
            callback_data:
              `final_period_next:${period}:${key}:${mode}`
          }
        ]]
      }
    }
  );
}


bot.action(
  /^final_period_(prev|next):(week|month):([^:]+):(mine|top)$/,
  async ctx => {

    try {

      const [
        ,
        direction,
        period,
        key,
        mode
      ] =
        ctx.match;

      const nextKey =
        finalEarningsShiftPeriodKey(
          period,
          key,
          direction === "next"
            ? 1
            : -1
        );

      await finalEarningsShowPeriodKey(
        ctx,
        period,
        nextKey,
        mode
      );

      await ctx.answerCbQuery();

    } catch (error) {

      console.error(
        "PERIOD NAV ERROR:",
        error
      );

      await ctx.answerCbQuery(
        "Ошибка ❌"
      );
    }
  }
);


// ============================================================
// 🏁 ИТОГ НЕДЕЛЬНЫХ ЦЕЛЕЙ
// ============================================================

async function finalEarningsFinalizeWeek() {

  try {

    const state =
      await finalEarningsLoad();

    const now =
      finalEarningsParseDate(
        finalEarningsToday()
      );

    if (!now) {
      return;
    }

    const monday =
      new Date(now);

    monday.setUTCDate(
      monday.getUTCDate() -
      7
    );

    const previousWeek =
      finalEarningsWeekKey(
        monday
      );

    if (
      state.goalHistory.week[
        previousWeek
      ]?.published
    ) {
      return;
    }

    const data =
      await finalEarningsPeriodEntriesForKey(
        "week",
        previousWeek,
        state
      );

    const lines = [];

    for (
      const [
        userId,
        goal
      ] of Object.entries(
        state.goals.week || {}
      )
    ) {

      if (
        !goal ||
        goal.periodKey !==
        previousWeek ||
        !(goal.target > 0)
      ) {
        continue;
      }

      const item =
        data.find(
          x =>
            String(
              x.userId
            ) ===
            String(
              userId
            )
        );

      const total =
        item?.total || 0;

      const percent =
        finalEarningsGoalPercent(
          total,
          goal.target
        );

      lines.push(
        `👤 ${item?.name ||
        state.users?.[
          userId
        ]?.name ||
        "Неизвестный"
        } — ${percent}% ` +
        `(${total}/${goal.target} грн)`
      );
    }

    state.goalHistory.week[
      previousWeek
    ] = {

      published:
        true,

      lines:
        lines
    };

    await finalEarningsSave(
      state
    );

    if (
      lines.length > 0 &&
      state.goalReportChatId
    ) {

      await bot.telegram.sendMessage(

        state.goalReportChatId,

        "🏁 ИТОГ НЕДЕЛЬНЫХ ЦЕЛЕЙ\n" +
        "━━━━━━━━━━━━━━\n\n" +

        lines.join(
          "\n"
        )
      );
    }

  } catch (error) {

    console.error(
      "FINALIZE WEEK ERROR:",
      error
    );
  }
}


// ============================================================
// ПОЛУЧЕНИЕ ПЕРИОДА ПО КОНКРЕТНОМУ КЛЮЧУ
// ============================================================

async function finalEarningsPeriodEntriesForKey(
  period,
  currentKey,
  state
) {

  const tipsState =
    await loadTipsState();

  await ensureTipsDay(
    tipsState
  );

  const totals = {};


  function add(
    id,
    name,
    glovo,
    bolt,
    ipost,
    bolttr,
    personal,
    quests,
    floors,
    tea
  ) {

    id =
      String(id);

    if (!totals[id]) {

      totals[id] = {

        userId:
          id,

        name:
          name ||
          "Неизвестный",

        glovo:
          0,

        bolt:
          0,

        ipost:
          0,

        bolttr:
          0,

        personal:
          0,

        quests:
          0,

        floors:
          0,

        tea:
          0
      };
    }

    if (name) {

      totals[id].name =
        name;
    }

    totals[id].glovo +=
      Number(glovo) || 0;

    totals[id].bolt +=
      Number(bolt) || 0;

    totals[id].ipost +=
      Number(ipost) || 0;

    totals[id].bolttr +=
      Number(bolttr) || 0;

    totals[id].personal +=
      Number(personal) || 0;

    totals[id].quests +=
      Number(quests) || 0;

    totals[id].floors +=
      Number(floors) || 0;

    totals[id].tea +=
      Number(tea) || 0;
  }


  for (
    const [
      dateKey,
      day
    ] of Object.entries(
      state.days || {}
    )
  ) {

    const parsed =
      finalEarningsParseDate(
        dateKey
      );

    if (!parsed) {
      continue;
    }

    const key =
      period === "week"
        ? finalEarningsWeekKey(
          parsed
        )
        : finalEarningsMonthKey(
          parsed
        );

    if (
      key !== currentKey
    ) {
      continue;
    }

    for (
      const [
        id,
        item
      ] of Object.entries(
        day || {}
      )
    ) {

      if (!item) {
        continue;
      }

      add(

        id,

        item.name ||
        state.users?.[id]?.name ||
        "Неизвестный",

        item.glovo,

        item.bolt,

        Number(item.ipost) ||
        Number(item.iposr) ||
        0,

        item.bolttr,

        item.personal,

        item.quests,

        item.floors,

        0
      );
    }
  }


  const tipDays = [];

  if (
    tipsState.currentDate
  ) {

    tipDays.push({
      date:
        tipsState.currentDate,

      tips:
        tipsState.today || {}
    });
  }

  for (
    const day
    of tipsState.archive || []
  ) {

    if (
      day?.date
    ) {

      tipDays.push(
        day
      );
    }
  }


  for (
    const day
    of tipDays
  ) {

    const parsed =
      finalEarningsParseDate(
        day.date
      );

    if (!parsed) {
      continue;
    }

    const key =
      period === "week"
        ? finalEarningsWeekKey(
          parsed
        )
        : finalEarningsMonthKey(
          parsed
        );

    if (
      key !== currentKey
    ) {
      continue;
    }

    for (
      const [
        id,
        item
      ] of Object.entries(
        day.tips || {}
      )
    ) {

      if (!item) {
        continue;
      }

      add(
        id,

        item.name ||
        "Неизвестный",

        0,
        0,
        0,
        0,
        0,
        0,
        0,

        item.amount
      );
    }
  }


  return Object.values(
    totals
  ).map(
    item => ({

      ...item,

      total:
        item.glovo +
        item.bolt +
        item.ipost +
        item.bolttr +
        item.personal +
        item.quests +
        item.floors +
        item.tea
    })
  );
}


// ============================================================
// 🕛 АВТОМАТИЧЕСКИЙ ИТОГ НЕДЕЛИ
// ============================================================

let finalEarningsGoalTimerStarted =
  false;

function finalEarningsStartGoalTimer() {

  if (
    finalEarningsGoalTimerStarted
  ) {
    return;
  }

  finalEarningsGoalTimerStarted =
    true;

  setInterval(
    async () => {

      try {

        const now =
          new Date();

        const parts =
          new Intl.DateTimeFormat(
            "en-GB",
            {
              timeZone:
                TIMEZONE,

              weekday:
                "short",

              hour:
                "2-digit",

              minute:
                "2-digit",

              hour12:
                false
            }
          ).formatToParts(
            now
          );

        const get =
          type =>
            parts.find(
              item =>
                item.type ===
                type
            )?.value;

        if (
          get("weekday") ===
          "Mon" &&

          get("hour") ===
          "00" &&

          get("minute") ===
          "00"
        ) {

          await finalEarningsFinalizeWeek();
        }

      } catch (error) {

        console.error(
          "GOAL TIMER ERROR:",
          error
        );
      }

    },
    30000
  );
}

finalEarningsStartGoalTimer();


// ============================================================
// /OB — ОБНУЛЕНИЕ ЗАРАБОТКА
//
// ВАЖНО:
// ЧАЕВЫЕ НЕ ОБНУЛЯЮТСЯ.
//
// Обнуляются:
//
// 🟡 Glovo
// 🟢 Bolt
// 🔴 iPOST
// 🚨 Bolt TR
// 👤 Личные доставки
// 🎯 Квесты
// ============================================================

bot.command(
  "ob",
  async ctx => {

    if (
      !isAdmin(ctx)
    ) {

      await ctx.reply(
        "Нет доступа ❌"
      );

      return;
    }

    try {

      const args =
        ctx.message.text
          .trim()
          .split(/\s+/)
          .slice(1);

      if (
        args.length < 2
      ) {

        await ctx.reply(

          "Использование:\n\n" +

          "/ob Имя Дата\n\n" +

          "Пример:\n" +

          "/ob Серёга 29.09.2026"
        );

        return;
      }

      const dateInput =
        args[
          args.length - 1
        ].trim();

      const name =
        args
          .slice(
            0,
            -1
          )
          .join(" ")
          .trim();

      const parsed =
        finalEarningsParseDate(
          dateInput
        );

      if (!parsed) {

        await ctx.reply(
          "❌ Неверный формат даты.\n\n" +
          "Используй:\n" +
          "/ob Имя ДД.ММ.ГГГГ"
        );

        return;
      }

      const dateKey =
        finalEarningsSlashDate(
          parsed
        );

      const state =
        await finalEarningsLoad();

      const day =
        finalEarningsFindDay(
          state,
          dateKey
        );

      if (!day) {

        await ctx.reply(
          `❌ За ${finalEarningsDotDate(
            parsed
          )
          } заработок не найден.`
        );

        return;
      }

      const normalizedName =
        name
          .trim()
          .toLowerCase();

      let userId =
        null;


      for (
        const id
        of Object.keys(day)
      ) {

        const item =
          day[id];

        if (
          String(
            item?.name ||
            ""
          )
            .trim()
            .toLowerCase() ===
          normalizedName
        ) {

          userId =
            id;

          break;
        }
      }


      if (
        !userId
      ) {

        for (
          const id
          of Object.keys(
            state.users || {}
          )
        ) {

          const item =
            state.users[id];

          if (
            String(
              item?.name ||
              ""
            )
              .trim()
              .toLowerCase() ===
            normalizedName
          ) {

            userId =
              id;

            break;
          }
        }
      }


      if (
        !userId ||
        !day[userId]
      ) {

        await ctx.reply(
          `❌ ${name} не найден за ${finalEarningsDotDate(
            parsed
          )
          }.`
        );

        return;
      }


      console.log("OB RESET", {
        callerId: ctx.from?.id,
        chatId: ctx.chat?.id,
        userId,
        docFound: true,
        dateKey,
        resetRecords: 1
      });

      day[userId].glovo =
        0;

      day[userId].bolt =
        0;

      day[userId].ipost =
        0;

      day[userId].bolttr =
        0;

      day[userId].personal =
        0;

      day[userId].quests =
        0;

      day[userId].floors =
        0;


      // ЧАЕВЫЕ НЕ ТРОГАЕМ.


      await finalEarningsSave(
        state
      );

      const historyState = await v3LoadEarningsState();
      const resetDateKey = v3DateISO(dateKey);
      for (const record of historyState.records || []) {
        if (record.userId === String(userId) && record.dateKey === resetDateKey && !record.canceledAt && record.type !== "tea") {
          record.canceledAt = new Date().toISOString();
          record.canceledBy = String(ctx.from.id);
          historyState.audit.push({ at: record.canceledAt, action: "reset", recordId: record.id, userId: String(userId), name, type: record.type, amount: record.amount, by: String(ctx.from.id) });
        }
      }
      await finalEarningsSave(historyState);

      await ctx.reply(

        "✅ Заработок обнулён\n\n" +

        `👤 ${day[userId].name ||
        name
        }\n` +

        `📅 ${finalEarningsDotDate(
          parsed
        )
        }\n\n` +

        "🟡 Glovo: 0 грн\n" +

        "🟢 Bolt: 0 грн\n" +

        "🔴 iPOST: 0 грн\n" +

        "🚨 Bolt TR: 0 грн\n" +

        "👤 Личные доставки: 0 грн\n" +

        "🎯 Квесты: 0 грн\n" +
        "🏢 Этажи: 0 грн\n\n" +

        "☕ Чаевые — НЕ ТРОНУТЫ"
      );

    } catch (error) {

      console.error(
        "OB RESET ERROR:",
        error
      );

      await ctx.reply(
        "❌ Ошибка обнуления."
      );
    }
  }
);


// ============================================================
// ☕ ТОП ЧАЕВЫХ
// ============================================================

async function finalTeaTop(
  ctx,
  period
) {

  try {

    const state =
      await loadTipsState();

    await ensureTipsDay(
      state
    );

    const totals = {};


    function addTips(
      entries
    ) {

      for (
        const [
          userId,
          item
        ] of Object.entries(
          entries || {}
        )
      ) {

        if (!item) {
          continue;
        }

        const id =
          String(userId);

        if (!totals[id]) {

          totals[id] = {

            name:
              item.name ||
              "Неизвестный",

            amount:
              0
          };
        }

        if (item.name) {

          totals[id].name =
            item.name;
        }

        totals[id].amount +=
          Number(
            item.amount
          ) || 0;
      }
    }


    if (
      period === "day"
    ) {

      addTips(
        state.today
      );
    }


    if (
      period === "week"
    ) {

      const weekKey =
        getCurrentWeekKeyForTips();

      for (
        const day
        of state.archive || []
      ) {

        if (
          !day?.date
        ) {
          continue;
        }

        if (
          getTipsWeekKeyFromDateKey(
            day.date
          ) !== weekKey
        ) {
          continue;
        }

        addTips(
          day.tips
        );
      }

      if (
        getTipsWeekKeyFromDateKey(
          state.currentDate
        ) === weekKey
      ) {

        addTips(
          state.today
        );
      }
    }


    if (
      period === "month"
    ) {

      const monthKey =
        getTipsMonthKey(
          getTipsDateKey()
        );

      for (
        const day
        of state.archive || []
      ) {

        if (
          !day?.date
        ) {
          continue;
        }

        if (
          getTipsMonthKey(
            day.date
          ) !== monthKey
        ) {
          continue;
        }

        addTips(
          day.tips
        );
      }

      if (
        getTipsMonthKey(
          state.currentDate
        ) === monthKey
      ) {

        addTips(
          state.today
        );
      }
    }


    const entries =
      Object.values(
        totals
      )
        .filter(
          item =>
            item.amount > 0
        )
        .sort(
          (
            a,
            b
          ) =>
            b.amount -
            a.amount
        );


    let title =
      "☕ ТОП ЧАЕВЫХ";

    if (
      period === "week"
    ) {

      title =
        "☕ ТОП ЧАЕВЫХ ЗА НЕДЕЛЮ";
    }

    if (
      period === "month"
    ) {

      title =
        "☕ ТОП ЧАЕВЫХ ЗА МЕСЯЦ";
    }


    let text =
      title +
      "\n━━━━━━━━━━━━━━\n\n";


    if (
      entries.length === 0
    ) {

      text +=
        "Чаевых пока нет 😢";

    } else {

      entries.forEach(
        (
          item,
          index
        ) => {

          text +=
            `${index + 1}. ` +
            `${item.name} — ` +
            `${item.amount} грн\n`;
        }
      );
    }

    await ctx.reply(
      text
    );

  } catch (error) {

    console.error(
      "TOP TEA ERROR:",
      error
    );

    await ctx.reply(
      "❌ Ошибка формирования топа чаевых."
    );
  }
}


bot.hears(
  /^топ чай$/i,
  async ctx => {

    await finalTeaTop(
      ctx,
      "day"
    );
  }
);


bot.hears(
  /^топ чай\s+неделя$/i,
  async ctx => {

    await finalTeaTop(
      ctx,
      "week"
    );
  }
);


bot.hears(
  /^топ чай\s+месяц$/i,
  async ctx => {

    await finalTeaTop(
      ctx,
      "month"
    );
  }
);


// ============================================================
// 🧪 ТЕСТ ДАТ
//
// /testtop
// ============================================================

bot.command(
  "testtop",
  async ctx => {

    try {

      if (
        !isAdmin(ctx)
      ) {

        await ctx.reply(
          "Нет доступа ❌"
        );

        return;
      }

      const today =
        finalEarningsToday();

      const parsed =
        finalEarningsParseDate(
          today
        );

      if (!parsed) {

        await ctx.reply(
          "❌ Не удалось определить дату."
        );

        return;
      }

      const dot =
        finalEarningsDotDate(
          parsed
        );

      const slash =
        finalEarningsSlashDate(
          parsed
        );

      const iso =
        finalEarningsISODate(
          parsed
        );

      const teaDot =
        await finalEarningsTeaForDate(
          dot
        );

      const teaSlash =
        await finalEarningsTeaForDate(
          slash
        );

      const teaISO =
        await finalEarningsTeaForDate(
          iso
        );


      function sumTea(
        data
      ) {

        return Object.values(
          data || {}
        ).reduce(
          (
            sum,
            item
          ) =>
            sum +
            (
              Number(
                item.amount
              ) || 0
            ),
          0
        );
      }


      const a =
        sumTea(
          teaDot
        );

      const b =
        sumTea(
          teaSlash
        );

      const c =
        sumTea(
          teaISO
        );

      const same =
        a === b &&
        b === c;


      await ctx.reply(

        "🧪 ТЕСТ ДАТ\n" +
        "━━━━━━━━━━━━━━\n\n" +

        `${dot} → ☕ ${a} грн\n` +

        `${slash} → ☕ ${b} грн\n` +

        `${iso} → ☕ ${c} грн\n\n` +

        "━━━━━━━━━━━━━━\n" +

        (
          same
            ? "✅ ВСЕ ТРИ ФОРМАТА СОВПАДАЮТ"
            : "❌ ФОРМАТЫ ОТЛИЧАЮТСЯ"
        )
      );

    } catch (error) {

      console.error(
        "TEST TOP ERROR:",
        error
      );

      await ctx.reply(
        "❌ Ошибка теста."
      );
    }
  }
);


// ============================================================
// КОНЕЦ ФИНАЛЬНОГО БЛОКА
// ============================================================
bot.on("sticker", async ctx => {
  try {
    const sticker = ctx.message?.sticker;
    if (!sticker) return;

    console.log("[Глобовец] Получен стикер:", {
      file_id: sticker.file_id,
      file_unique_id: sticker.file_unique_id,
      set_name: sticker.set_name || null
    });

    if (sticker.file_unique_id === "AgADI20AAkY4iEo") {
      await ctx.replyWithSticker(
        "CAACAgIAAxkBAAIsZGruXnFLLIlCst7pJ7tR1OSTJWRgAAKPogACVb0wSomNG0IFRJ3uPQQ",
        { reply_to_message_id: ctx.message.message_id }
      );
      console.log("[Глобовец] Ответный стикер отправлен.");
    }
  } catch (error) {
    console.error("Ошибка ответного стикера:", error);
  }
});


// ============================================================
// МЕМЫ ПО КЛЮЧЕВЫМ СЛОВАМ
// Стикер выбирается случайно, если вариантов несколько
// ============================================================

const MEME_STICKERS = {
  "окак": [
    "CAACAgIAAxkBAAMxasQUc-n5pjb933DydBWOtptDEwcAAmF0AAJRmulItM180EJaapk9BA",
    "CAACAgIAAxkBAAMzasQUfW-hPgsIHJcL-U7RNPOsLxMAAvBhAAKXNqBJzaCxctNEJUE9BA",
    "CAACAgIAAxkBAAM1asQU1d0YS1XXunwjJ8Poq0qbC7cAAlFkAAKgjYBKxW-LiTk9YRg9BA"
  ],

  "костя": [
    "CAACAgIAAxkBAAM3asQVU6nb-w8chSQHZV5pPvIvOvEAAp2aAAIReuBI0bcGu6VYNio9BA"
  ],

  "мать": [
    "CAACAgIAAxkBAAM5asQVb0b7hxlCGLZdzrL98qXXjiwAAqOxAAIideBItQZV3b5A43w9BA"
  ],

  "гц": [
    "CAACAgIAAxkBAAM7asQVfJ_42GAvn1-7UrjIwkHD-TcAAiySAAIH2jhIW8Lm8rjcTfg9BA"
  ],

  "да": [
    "CAACAgIAAxkBAAM9asQVnyvfxFzM1YAeM4Y8q2Vdk_cAAkdaAAKEmFhJG3joGN10UD89BA"
  ]
};


// ============================================================
// ОБРАБОТКА МЕМОВ
// ============================================================

bot.on("text", async (ctx, next) => {
  try {
    const text = ctx.message.text?.trim().toLowerCase();

    if (!text) return next();

    const stickers = MEME_STICKERS[text];

    if (!stickers || stickers.length === 0) return next();

    // Случайный стикер
    const randomSticker =
      stickers[Math.floor(Math.random() * stickers.length)];

    await ctx.replyWithSticker(randomSticker);

  } catch (err) {
    console.error("Ошибка отправки мем-стикера:", err);
    return next();
  }
});


// ============================================================
// GLOBOVETS V3 EXTENSION
// Дневные цели, общий прогресс, календарь, сравнение,
// быстрый ввод, история и адресная отмена записей.
// ============================================================

const V3_ACHIEVEMENT_START_DATE = "2026-11-19";

async function v3LoadEarningsState() {
  const state = await finalEarningsLoad();
  if (!state.goals) state.goals = {};
  if (!state.goals.day) state.goals.day = {};
  if (!Array.isArray(state.records)) state.records = [];
  if (!Array.isArray(state.audit)) state.audit = [];
  if (!Array.isArray(state.goalReportChatIds)) state.goalReportChatIds = [];
  if (!state.v3Sent) state.v3Sent = {};
  if (!Array.isArray(state.achievements)) state.achievements = [];
  if (state.achievementTrackingStart !== V3_ACHIEVEMENT_START_DATE) {
    // Не удаляем историю наград при обновлении версии системы.
    state.achievementTrackingStart = V3_ACHIEVEMENT_START_DATE;
    await finalEarningsSave(state);
  }
  if (!state.goalHistory) state.goalHistory = {};
  if (!state.goalHistory.day) state.goalHistory.day = {};
  if (state.achievementsEnabled === undefined) state.achievementsEnabled = true;
  return state;
}

function v3DateISO(value) {
  const parsed = finalEarningsParseDate(value || finalEarningsToday());
  return parsed ? finalEarningsISODate(parsed) : null;
}

async function v3AddRecord(data) {
  const state = await v3LoadEarningsState();
  const record = {
    id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    userId: String(data.userId),
    name: String(data.name || state.users?.[String(data.userId)]?.name || "Курьер"),
    type: String(data.type),
    amount: Number(data.amount),
    dateKey: v3DateISO(data.dateKey),
    createdAt: new Date().toISOString(),
    createdBy: String(data.createdBy || data.userId),
    canceledAt: null,
    canceledBy: null
  };
  if (!record.dateKey || !Number.isInteger(record.amount) || record.amount <= 0) return;
  state.users[record.userId] = state.users[record.userId] || { name: record.name };
          state.users[record.userId].name = record.name;
          state.records.push(record);
  state.audit.push({ at: record.createdAt, action: "add", recordId: record.id, userId: record.userId, name: record.name, type: record.type, amount: record.amount, by: record.createdBy });
  if (state.records.length > 15000) state.records = state.records.slice(-15000);
  if (state.audit.length > 15000) state.audit = state.audit.slice(-15000);
  await finalEarningsSave(state);
  await v3CheckAchievements(record.userId);
}

const v3OriginalEarningsAdd = finalEarningsAdd;
finalEarningsAdd = async function(ctx, type, amount, dateInput) {
  await v3OriginalEarningsAdd(ctx, type, amount, dateInput);
  const parsed = finalEarningsParseDate(dateInput || finalEarningsToday());
  if (parsed && Number.isInteger(amount) && amount > 0 && ["glovo","bolt","ipost","bolttr"].includes(type)) {
    await v3AddRecord({ userId: ctx.from.id, name: getTelegramDisplayName(ctx), type, amount, dateKey: finalEarningsISODate(parsed), createdBy: ctx.from.id });
  }
};

const v3OriginalEarningsAddExtra = finalEarningsAddExtra;
finalEarningsAddExtra = async function(ctx, type, amount, dateInput) {
  await v3OriginalEarningsAddExtra(ctx, type, amount, dateInput);
  const parsed = finalEarningsParseDate(dateInput || finalEarningsToday());
  if (parsed && Number.isInteger(amount) && amount > 0 && ["personal","floors","quests"].includes(type)) {
    await v3AddRecord({ userId: ctx.from.id, name: getTelegramDisplayName(ctx), type, amount, dateKey: finalEarningsISODate(parsed), createdBy: ctx.from.id });
  }
};

// Быстрый ввод нескольких показателей: Г 500 Б 300 А 200.
bot.hears(/^(?:(?:г|б|а)\s+\d+\s*){2,}$/i, async ctx => {
  const parts = String(ctx.message.text || "").trim().split(/\s+/);
  if (parts.length % 2 !== 0) return;
  const rows = [];
  for (let i = 0; i < parts.length; i += 2) {
    const type = parts[i].toLowerCase() === "г" ? "glovo" : parts[i].toLowerCase() === "б" ? "bolt" : "ipost";
    const amount = finalEarningsAmount(parts[i + 1]);
    if (!Number.isInteger(amount) || amount <= 0) {
      await ctx.reply("❌ Проверь суммы. Пример: Г 500 Б 300 А 200");
      return;
    }
    rows.push({ type, amount });
  }
  for (const row of rows) await finalEarningsAdd(ctx, row.type, row.amount, finalEarningsToday());
  await ctx.reply("✅ Быстрый ввод завершён: " + rows.length + " операций.");
});

// Дневная цель. Повторная команда меняет цель на новое значение.
bot.hears(/^цель\s+(\d+)$/i, async ctx => {
  const target = Number(ctx.match[1]);
  if (!Number.isInteger(target) || target <= 0) {
    await ctx.reply("Укажи цель целым числом больше 0. Пример: Цель 2000");
    return;
  }
  const state = await v3LoadEarningsState();
  const userId = String(ctx.from.id);
  const dateKey = v3DateISO(finalEarningsToday());
  state.users[userId] = state.users[userId] || {};
  state.users[userId].name = getTelegramDisplayName(ctx);
  const oldGoal=Number(state.goals.day[userId]?.dateKey===dateKey?state.goals.day[userId]?.target:0)||0;
  const currentReport=await finalEarningsReport(userId,dateKey);
  const changedAfterComplete=oldGoal>0 && currentReport.total>=oldGoal;
  const setAt=new Date().toISOString();
  state.goals.day[userId] = { dateKey, target, setAt };
  state.goalHistory.day[userId] = state.goalHistory.day[userId] || {};
  const previousGoal=state.goalHistory.day[userId][dateKey]||{};
  state.goalHistory.day[userId][dateKey] = { target, setAt, changedAfterComplete:!!(previousGoal.changedAfterComplete||changedAfterComplete) };
  state.achievementActivity=state.achievementActivity||{};
  state.achievementActivity[userId]=state.achievementActivity[userId]||{};
  state.achievementActivity[userId][dateKey]=state.achievementActivity[userId][dateKey]||{commands:0,statsOpens:0,goalChanges:0,goalTargets:[]};
  const activity=state.achievementActivity[userId][dateKey];
  activity.goalChanges=(Number(activity.goalChanges)||0)+1;
  activity.goalTargets=Array.isArray(activity.goalTargets)?activity.goalTargets:[];
  activity.goalTargets.push(target);
  if (ctx.chat?.id && !state.goalReportChatIds.includes(ctx.chat.id)) state.goalReportChatIds.push(ctx.chat.id);
  state.goalReportChatId = ctx.chat?.id || state.goalReportChatId || null;
  await finalEarningsSave(state);
  await v3CheckAchievements(userId);
  await ctx.reply("🎯 Дневная цель установлена\n\n👤 " + getTelegramDisplayName(ctx) + "\n💰 " + target + " грн");
});

async function v3BuildDailyProgress(dateKey) {
  const state = await v3LoadEarningsState();
  const lines = [];
  for (const [userId, goal] of Object.entries(state.goals.day || {})) {
    if (!goal || goal.dateKey !== dateKey || !(Number(goal.target) > 0)) continue;
    const report = await finalEarningsReport(userId, dateKey);
    const percent = Math.round(report.total / Number(goal.target) * 100);
    lines.push({ name: report.name || state.users?.[userId]?.name || "Курьер", total: report.total, target: Number(goal.target), percent });
  }
  lines.sort((a,b) => b.percent - a.percent || b.total - a.total);
  return lines;
}

async function v3SendProgress(isFinal = false) {
  const state = await v3LoadEarningsState();
  const dateKey = v3DateISO(finalEarningsToday());
  const marker = isFinal ? "final:" + dateKey : "progress:" + dateKey + ":" + new Intl.DateTimeFormat("en-GB",{timeZone:TIMEZONE,hour:"2-digit",hour12:false}).format(new Date());
  if (state.v3Sent[marker]) return;
  const rows = await v3BuildDailyProgress(dateKey);
  if (!rows.length) return;
  const body = rows.map((x,i) => (i+1) + ". " + x.name + " — " + x.total + "/" + x.target + " грн (" + x.percent + "%)" + (x.percent >= 100 ? " 🏆" : "")).join("\n");
  const message = (isFinal ? "📊 ИТОГ ДНЕВНЫХ ЦЕЛЕЙ" : "🎯 ПРОГРЕСС ДНЕВНЫХ ЦЕЛЕЙ") + "\n━━━━━━━━━━━━━━\n📅 " + finalEarningsDotDate(finalEarningsParseDate(dateKey)) + "\n\n" + body;
  const chats = [...new Set([...(state.goalReportChatIds || []), state.goalReportChatId].filter(Boolean))];
  for (const chatId of chats) {
    try { await bot.telegram.sendMessage(chatId, message); }
    catch (error) { console.error("V3 progress send failed:", chatId, error.message); }
  }
  state.v3Sent[marker] = true;
  await finalEarningsSave(state);
}

let v3DailyTimerStarted = false;
let v3AchievementBackfillStarted = false;
function v3StartDailyTimer() {
  if (v3DailyTimerStarted) return;
  v3DailyTimerStarted = true;
  setInterval(async () => {
    try {
      if(!v3AchievementBackfillStarted){
        await v3EvaluateAllAchievements("instant");
        v3AchievementBackfillStarted=true;
      }
      const parts = new Intl.DateTimeFormat("en-GB",{timeZone:TIMEZONE,weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
      const get = type => parts.find(x => x.type === type)?.value;
      const hour = Number(get("hour"));
      const minute = get("minute");
      if (minute !== "00" && minute !== "59") return;
      if (minute === "00" && hour >= 7 && hour <= 22 && (hour - 7) % 3 === 0) await v3SendProgress(false);
      if (minute === "59" && hour === 23) {
        await v3SendProgress(true);
        await v3EvaluateAllAchievements("daily");
        const today=finalEarningsParseDate(v3DateISO(finalEarningsToday()));
        if(today.getUTCDay()===0) await v3EvaluateAllAchievements("weekly");
        const tomorrow=new Date(today);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
        if(tomorrow.getUTCMonth()!==today.getUTCMonth()) await v3EvaluateAllAchievements("monthly");
      }
    } catch (error) { console.error("V3 daily timer:", error); }
  }, 20000);
}
v3StartDailyTimer();

// Форматы: Логи (имя) (ДД.ММ.ГГГГ) и Запись (имя) ДД.ММ.ГГГГ.
bot.hears(/^(?:логи|запись)\s*\((.+?)\)(?:\s+\(?(\d{2}[./]\d{2}[./]\d{4})\)?)?$/i, async ctx => {
  if (!isAdmin(ctx)) return ctx.reply("Нет доступа ❌");
  const name = ctx.match[1].trim();
  const dateKey = v3DateISO(ctx.match[2] || finalEarningsToday());
  const state = await v3LoadEarningsState();
  state.adminLogContexts = state.adminLogContexts || {};
  delete state.adminLogContexts[String(ctx.from.id)];
  const user = Object.entries(state.users || {}).find(([id,u]) => String(u?.name || "").trim().toLowerCase() === name.toLowerCase());
  if (!user) { await finalEarningsSave(state); return ctx.reply("❌ Курьер не найден: " + name); }
  const [userId] = user;
  const rows = (state.records || [])
    .filter(r => r.userId === String(userId) && r.dateKey === dateKey && !r.canceledAt)
    .sort((a,b) => String(a.createdAt||"").localeCompare(String(b.createdAt||"")) || String(a.id).localeCompare(String(b.id)));
  if (!rows.length) { await finalEarningsSave(state); return ctx.reply("📒 Записей " + name + " за " + finalEarningsDotDate(finalEarningsParseDate(dateKey)) + " нет.\nСтарые суммы, внесённые до версии 3.0, не имеют разбивки по отдельным операциям."); }
  const labels = { glovo:"Glovo", bolt:"Bolt", ipost:"iPOST", bolttr:"Bolt TR", personal:"Личные доставки", floors:"Этажи", quests:"Квесты", tea:"Чай" };
  const total = rows.reduce((sum,r) => sum + (Number(r.amount)||0), 0);
  const lines = rows.map((r,i) => (i+1) + ". " + (labels[r.type] || r.type) + " — " + r.amount + " грн");
  state.adminLogContexts = state.adminLogContexts || {};
  state.adminLogContexts[String(ctx.from.id)] = { userId:String(userId), name, dateKey, recordIds:rows.map(r=>r.id), createdAt:new Date().toISOString() };
  await finalEarningsSave(state);
  await ctx.reply("📋 ЛОГИ — " + name + "\n📅 " + finalEarningsDotDate(finalEarningsParseDate(dateKey)) + "\n━━━━━━━━━━━━━━\n" + lines.join("\n") + "\n━━━━━━━━━━━━━━\n💰 Всего по новым записям: " + total + " грн\n\nДля отмены записи используй: Отмена (" + name + ") номер");
});

// Отмена (имя) 2 — отменяет запись из последнего списка логов; без списка — последнюю запись за сегодня.
bot.hears(/^отмена\s*\((.+?)\)(?:\s+\(?(\d+)\)?)?$/i, async ctx => {
  if (!isAdmin(ctx)) return ctx.reply("Нет доступа ❌");
  const name = ctx.match[1].trim();
  const requested = ctx.match[2] !== undefined ? Number(ctx.match[2]) : null;
  if(requested!==null && (!Number.isInteger(requested)||requested<1))return ctx.reply("❌ Номер записи должен быть положительным числом.");
  const state = await v3LoadEarningsState();
  const user = Object.entries(state.users || {}).find(([id,u]) => String(u?.name || "").trim().toLowerCase() === name.toLowerCase());
  if (!user) return ctx.reply("❌ Курьер не найден: " + name);
  const [userId] = user;
  const adminId=String(ctx.from.id);
  const context=state.adminLogContexts?.[adminId];
  let rows=[],record=null,index=-1;
  if(requested!==null && context && String(context.userId)===String(userId)){
    index=requested-1;
    const recordId=context.recordIds?.[index];
    record=(state.records||[]).find(r=>r.id===recordId && String(r.userId)===String(userId) && !r.canceledAt);
    if(!record)return ctx.reply("❌ Такой активной записи нет в последнем списке логов. Сначала вызови «Логи ("+name+") (дата)» ещё раз.");
  }else{
    if(requested!==null && context && String(context.userId)!==String(userId)) return ctx.reply("❌ Последний список логов открыт для другого курьера. Сначала вызови «Логи ("+name+") (дата)».");
    const today=v3DateISO(finalEarningsToday());
    rows=(state.records||[])
      .filter(r=>String(r.userId)===String(userId)&&r.dateKey===today&&!r.canceledAt)
      .sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))||String(a.id).localeCompare(String(b.id)));
    if(!rows.length)return ctx.reply("❌ Нет активных записей за сегодня.");
    index=requested!==null?requested-1:rows.length-1;
    if(!Number.isInteger(index)||index<0||index>=rows.length)return ctx.reply("❌ Такой записи нет. Используй «Логи ("+name+") (дата)» для списка.");
    record=rows[index];
  }
  const date=finalEarningsParseDate(record.dateKey);
  if(record.type==="tea"){
    const tips=await loadTipsState();
    await ensureTipsDay(tips);
    const dateISO=record.dateKey;
    if(tips.currentDate===dateISO&&tips.today?.[userId])tips.today[userId].amount=Math.max(0,(Number(tips.today[userId].amount)||0)-record.amount);
    else{
      const archived=(tips.archive||[]).find(d=>v3DateISO(d.date)===dateISO);
      if(archived?.tips?.[userId])archived.tips[userId].amount=Math.max(0,(Number(archived.tips[userId].amount)||0)-record.amount);
    }
    await saveTipsState(tips);
  }else{
    const earnings=await finalEarningsLoad();
    const day=finalEarningsFindDay(earnings,record.dateKey)||finalEarningsFindDay(earnings,finalEarningsSlashDate(date));
    if(!day?.[userId])return ctx.reply("❌ Не удалось найти сумму для отмены. Запись оставлена без изменений.");
    day[userId][record.type]=Math.max(0,(Number(day[userId][record.type])||0)-record.amount);
    await finalEarningsSave(earnings);
  }
  const freshState=await v3LoadEarningsState();
  const freshRecord=(freshState.records||[]).find(r=>r.id===record.id);
  if(!freshRecord||freshRecord.canceledAt)return ctx.reply("❌ Эта запись уже отменена.");
  freshRecord.canceledAt=new Date().toISOString();
  freshRecord.canceledBy=adminId;
  freshState.audit.push({at:freshRecord.canceledAt,action:"cancel",recordId:freshRecord.id,userId:String(userId),name,type:freshRecord.type,amount:freshRecord.amount,by:adminId});
  if(freshState.adminLogContexts)delete freshState.adminLogContexts[adminId];
  await finalEarningsSave(freshState);
  await v3CheckAchievements(String(userId),true);
  await ctx.reply("✅ Запись отменена\n\n👤 "+name+"\n📅 "+finalEarningsDotDate(date)+"\n№"+(index+1)+" — "+record.amount+" грн");
});

bot.hears(/^(?:аист|история)$/i, async ctx => {
  const state = await v3LoadEarningsState();
  const rows = (state.audit || []).slice(-15).reverse();
  if (!rows.length) return ctx.reply("История пока пуста.");
  const lines = rows.map(x => {
    const action = x.action === "cancel" ? "❌ отмена" : "➕ добавление";
    return action + " — " + (x.name || x.userId) + ": " + x.amount + " грн (" + x.type + ")\n" + new Date(x.at).toLocaleString("ru-RU",{timeZone:TIMEZONE});
  });
  await ctx.reply("📜 ИСТОРИЯ ИЗМЕНЕНИЙ\n━━━━━━━━━━━━━━\n" + lines.join("\n\n"));
});

// Рисуем PNG календаря без нативных модулей и внешних зависимостей.
async function v3Calendar(ctx, monthInput) {
  const match=String(monthInput||"").match(/^(\d{4})[.-](\d{2})$/),now=finalEarningsParseDate(finalEarningsToday());
  const year=match?Number(match[1]):now.getUTCFullYear(),month=match?Number(match[2]):now.getUTCMonth()+1;
  if(month<1||month>12)return ctx.reply("❌ Формат: Календарь 2026.10");
  const userId=String(ctx.from.id),daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate(),daily=[],details=[];
  let total=0,workdays=0;
  for(let day=1;day<=daysInMonth;day++){
    const key=year+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    const report=await finalEarningsReport(userId,key),amount=Math.max(0,Math.round(Number(report.total)||0));
    daily.push(amount);if(amount>0){total+=amount;workdays++;}
    details.push(String(day).padStart(2,"0")+": Glovo "+(report.glovo||0)+" | Bolt "+(report.bolt||0)+" | iPOST "+(report.ipost||0)+" | Bolt TR "+(report.bolttr||0)+" | Личные "+(report.personal||0)+" | Этажи "+(report.floors||0)+" | Чай "+(report.tea||0)+" | Итого "+amount+" грн");
  }
  const average=workdays?total/workdays:0;
  const width=840,height=960,pixels=Buffer.alloc(width*height*4);
  const C={bg:[15,23,42,255],empty:[38,50,68,255],above:[20,120,75,255],near:[180,135,20,255],below:[150,45,55,255],panel:[30,41,59,255],accent:[250,204,21,255],white:[248,250,252,255],muted:[148,163,184,255],line:[71,85,105,255]};
  function rect(x,y,w,h,c){for(let yy=Math.max(0,y);yy<Math.min(height,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(width,x+w);xx++){const p=(yy*width+xx)*4;pixels[p]=c[0];pixels[p+1]=c[1];pixels[p+2]=c[2];pixels[p+3]=c[3];}}
  const F={"0":[14,17,19,21,25,17,14],"1":[4,12,4,4,4,4,14],"2":[14,17,1,2,4,8,31],"3":[30,1,1,14,1,17,14],"4":[2,6,10,18,31,2,2],"5":[31,16,16,30,1,17,14],"6":[6,8,16,30,17,17,14],"7":[31,1,2,4,8,8,8],"8":[14,17,17,14,17,17,14],"9":[14,17,17,15,1,2,12],"A":[14,17,17,31,17,17,17],"B":[30,17,17,30,17,17,30],"C":[14,17,16,16,16,17,14],"D":[28,18,17,17,17,18,28],"E":[31,16,16,30,16,16,31],"F":[31,16,16,30,16,16,16],"G":[14,17,16,23,17,17,15],"H":[17,17,17,31,17,17,17],"I":[14,4,4,4,4,4,14],"J":[7,2,2,2,2,18,12],"K":[17,18,20,24,20,18,17],"L":[16,16,16,16,16,16,31],"M":[17,27,21,21,17,17,17],"N":[17,25,21,19,17,17,17],"O":[14,17,17,17,17,17,14],"P":[30,17,17,30,16,16,16],"Q":[14,17,17,17,21,18,13],"R":[30,17,17,30,20,18,17],"S":[15,16,16,14,1,1,30],"T":[31,4,4,4,4,4,4],"U":[17,17,17,17,17,17,14],"V":[17,17,17,17,17,10,4],"W":[17,17,17,21,21,21,10],"X":[17,17,10,4,10,17,17],"Y":[17,17,10,4,4,4,4],"Z":[31,1,2,4,8,16,31],".":[0,0,0,0,0,12,12],":":[0,12,12,0,12,12,0],"-":[0,0,0,31,0,0,0],"/":[1,2,2,4,8,8,16]," ":[0,0,0,0,0,0,0]};
  function txt(value,x,y,scale,color){let cx=x;for(const ch of String(value).toUpperCase()){const g=F[ch]||F[" "];for(let yy=0;yy<7;yy++)for(let xx=0;xx<5;xx++)if(g[yy]&(1<<(4-xx)))rect(cx+xx*scale,y+yy*scale,scale,scale,color);cx+=6*scale;}return cx-x;}
  rect(0,0,width,height,C.bg);rect(0,0,width,10,C.accent);txt("GLOBOVETS / EARNINGS",42,38,4,C.white);txt(year+"."+String(month).padStart(2,"0"),42,82,4,C.accent);rect(500,42,12,12,C.above);txt("ABOVE AVG",520,43,1,C.muted);rect(625,42,12,12,C.near);txt("AVG +/- 350",645,43,1,C.muted);rect(500,62,12,12,C.below);txt("BELOW AVG",520,63,1,C.muted);
  const labels=["MON","TUE","WED","THU","FRI","SAT","SUN"],left=24,top=190,gap=8,cw=108,ch=100;
  for(let col=0;col<7;col++)txt(labels[col],left+col*(cw+gap)+24,160,2,C.muted);
  const offset=(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7;
  for(let day=1;day<=daysInMonth;day++){const slot=offset+day-1,row=Math.floor(slot/7),col=slot%7,x=left+col*(cw+gap),y=top+row*(ch+gap),amount=daily[day-1],dayColor=amount<=0?C.empty:amount>average+350?C.above:amount<average-350?C.below:C.near;rect(x,y,cw,ch,dayColor);rect(x,y, cw,4,amount>0?dayColor:C.line);txt(String(day).padStart(2,"0"),x+10,y+13,3,C.white);if(amount>0){txt(String(amount),x+10,y+59,2,C.white);rect(x+cw-17,y+13,7,7,C.accent);}else txt("-",x+12,y+61,2,C.muted);}
  const fy=top+6*(ch+gap)+8;rect(24,fy,792,104,C.panel);txt("TOTAL "+total+" UAH",44,fy+18,3,C.accent);txt("WORK DAYS "+workdays,44,fy+62,2,C.white);txt("AVG "+Math.round(average)+" UAH",450,fy+62,2,C.white);
  function crc32(buf){let v=0xffffffff;for(const z of buf){v^=z;for(let k=0;k<8;k++)v=(v>>>1)^((v&1)?0xedb88320:0);}return(v^0xffffffff)>>>0;}
  function chunk(type,data){const t=Buffer.from(type),l=Buffer.alloc(4),cr=Buffer.alloc(4);l.writeUInt32BE(data.length);cr.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([l,t,data,cr]);}
  const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++){const o=y*(width*4+1);raw[o]=0;pixels.copy(raw,o+1,y*width*4,(y+1)*width*4);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",__globovetsZlib.deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);
  const caption="🗓 Календарь заработка "+String(month).padStart(2,"0")+"."+year+"\n💰 Итого: "+total+" грн | 📅 Рабочих дней: "+workdays+" | 📊 Среднее: "+(workdays?Math.round(total/workdays):0)+" грн";
  await ctx.replyWithPhoto({source:png},{caption});
}
bot.hears(/^календарь(?:\s+(\d{4}[.-]\d{2}))?$/i, async ctx => v3Calendar(ctx,ctx.match[1]));

// Исторический формат: Мой месяц 2026.10
bot.hears(/^мой месяц\s+(\d{4})[.-](\d{2})$/i, async ctx => {
  const key = ctx.match[1] + "-" + ctx.match[2];
  if (Number(ctx.match[2]) < 1 || Number(ctx.match[2]) > 12) return ctx.reply("❌ Неверный месяц. Пример: Мой месяц 2026.10");
  await finalEarningsShowPeriodKey(ctx,"month",key,"mine");
});

// Сравнение: Сравнить 2026.10-2026.11
bot.hears(/^сравнить\s+(\d{4})[.-](\d{2})\s*-\s*(\d{4})[.-](\d{2})$/i, async ctx => {
  const a = ctx.match[1] + "-" + ctx.match[2];
  const b = ctx.match[3] + "-" + ctx.match[4];
  if ([Number(ctx.match[2]),Number(ctx.match[4])].some(x=>x<1||x>12)) return ctx.reply("❌ Формат: Сравнить 2026.10-2026.11");
  const userId = String(ctx.from.id);
  const x = await finalEarningsPeriodEntriesForKey("month",a,await finalEarningsLoad());
  const y = await finalEarningsPeriodEntriesForKey("month",b,await finalEarningsLoad());
  const get = rows => rows.find(r=>String(r.userId)===userId) || {total:0,tea:0,floors:0};
  const left = get(x), right = get(y);
  const workdays = async key => {
    const state = await finalEarningsLoad();
    const counted = new Set();
    for (const [date,day] of Object.entries(state.days||{})) {
      const parsed=finalEarningsParseDate(date);
      if (parsed && finalEarningsMonthKey(parsed)===key) {
        const item = day?.[userId] || {};
        let worked = (Number(item.glovo)||0)+(Number(item.bolt)||0)+(Number(item.ipost)||Number(item.iposr)||0)+(Number(item.bolttr)||0)+(Number(item.personal)||0)+(Number(item.floors)||0)+(Number(item.quests)||0)>0;
        if (!worked) { const tea = await finalEarningsTeaForDate(date); worked = Number(tea?.[userId]?.amount) > 0; }
        if (worked) counted.add(finalEarningsISODate(parsed));
      }
    }
    const tipsState = await loadTipsState();
    await ensureTipsDay(tipsState);
    const tipDays = [];
    if (tipsState.currentDate) tipDays.push({ date: tipsState.currentDate, tips: tipsState.today || {} });
    for (const day of tipsState.archive || []) if (day?.date) tipDays.push(day);
    for (const day of tipDays) {
      const parsed = finalEarningsParseDate(day.date);
      if (parsed && finalEarningsMonthKey(parsed) === key && Number(day.tips?.[userId]?.amount) > 0) counted.add(finalEarningsISODate(parsed));
    }
    return counted.size;
  };
  const wa=await workdays(a), wb=await workdays(b);
  await ctx.reply("📊 СРАВНЕНИЕ МЕСЯЦЕВ\n━━━━━━━━━━━━━━\n" + a + ":\n💰 " + left.total + " грн\n☕ Чай: " + left.tea + " грн\n🏢 Этажи: " + left.floors + " грн\n📅 Рабочих дней: " + wa + "\n📈 Среднее/рабочий день: " + (wa?Math.round(left.total/wa):0) + " грн\n\n" + b + ":\n💰 " + right.total + " грн\n☕ Чай: " + right.tea + " грн\n🏢 Этажи: " + right.floors + " грн\n📅 Рабочих дней: " + wb + "\n📈 Среднее/рабочий день: " + (wb?Math.round(right.total/wb):0) + " грн\n\nРазница: " + (right.total-left.total) + " грн");
});

// Средний заработок за рабочий день в текущих недельных/месячных отчётах.
async function v3AverageForPeriod(userId, period, key) {
  const state = await finalEarningsLoad();
  const days = new Set();
  for (const [date,day] of Object.entries(state.days||{})) {
    const parsed=finalEarningsParseDate(date);
    if (!parsed) continue;
    const pkey=period==="week"?finalEarningsWeekKey(parsed):finalEarningsMonthKey(parsed);
    const item=day?.[String(userId)]||{};
    const sum=(Number(item.glovo)||0)+(Number(item.bolt)||0)+(Number(item.ipost)||Number(item.iposr)||0)+(Number(item.bolttr)||0)+(Number(item.personal)||0)+(Number(item.floors)||0)+(Number(item.quests)||0);
    if(pkey===key) {
      let worked = sum > 0;
          if (!worked) { const tea = await finalEarningsTeaForDate(date); worked = Number(tea?.[String(userId)]?.amount) > 0; }
      if (worked) days.add(finalEarningsISODate(parsed));
          }
  }
  const tipsState = await loadTipsState();
  await ensureTipsDay(tipsState);
  const tipDays = [];
  if (tipsState.currentDate) tipDays.push({ date: tipsState.currentDate, tips: tipsState.today || {} });
  for (const day of tipsState.archive || []) if (day?.date) tipDays.push(day);
  for (const day of tipDays) {
    const parsed = finalEarningsParseDate(day.date);
    const pkey = parsed ? (period === "week" ? finalEarningsWeekKey(parsed) : finalEarningsMonthKey(parsed)) : null;
    if (pkey === key && Number(day.tips?.[String(userId)]?.amount) > 0) days.add(finalEarningsISODate(parsed));
  }
  const data=await finalEarningsPeriodEntriesForKey(period,key,state);
  const mine=data.find(x=>String(x.userId)===String(userId));
  const total=(mine?.total)||0;
  return {days:days.size,average:days.size?Math.round(total/days.size):0};
}




// ============================================================
// V3 ACHIEVEMENTS SYSTEM — 25 awards, period-aware and persistent
// ============================================================

const V3_ACHIEVEMENTS = [
  {
    "id": "dvushka",
    "name": "Двушка",
    "description": "Больше 2 000 грн заработка за день",
    "repeat": "day"
  },
  {
    "id": "korol_smeny",
    "name": "Король смены",
    "description": "Больше 10 000 грн заработка за день",
    "repeat": "day"
  },
  {
    "id": "zhirny_kush",
    "name": "Жирный куш",
    "description": "Больше 5 000 грн заработка за день",
    "repeat": "day"
  },
  {
    "id": "denezhny_dozhd",
    "name": "Денежный дождь",
    "description": "50 000 грн заработка за неделю",
    "repeat": "week"
  },
  {
    "id": "denezhny_meshok",
    "name": "Денежный мешок",
    "description": "150 000 грн заработка за месяц",
    "repeat": "month"
  },
  {
    "id": "pervyi_vyhod",
    "name": "Первый выход",
    "description": "Первая любая рабочая запись",
    "repeat": "once"
  },
  {
    "id": "znakomstvo_s_chatom",
    "name": "Знакомство с чатом",
    "description": "Отправить первое обычное текстовое сообщение в общем чате",
    "repeat": "once"
  },
  {
    "id": "trudyaga",
    "name": "Трудяга",
    "description": "7 рабочих дней подряд",
    "repeat": "once"
  },
  {
    "id": "bez_otdyha",
    "name": "Без отдыха",
    "description": "10 рабочих дней подряд",
    "repeat": "once"
  },
  {
    "id": "zhelezny_chelovek",
    "name": "Железный человек",
    "description": "20 рабочих дней подряд",
    "repeat": "once"
  },
  {
    "id": "mashina",
    "name": "Машина",
    "description": "Отработать каждый календарный день месяца",
    "repeat": "month"
  },
  {
    "id": "veteran",
    "name": "Ветеран",
    "description": "100 рабочих дней с 19.11.2026",
    "repeat": "once"
  },
  {
    "id": "pervye_500",
    "name": "Первые 500",
    "description": "Получить 500 грн чаевых одним начислением",
    "repeat": "once"
  },
  {
    "id": "kasar",
    "name": "Касарь",
    "description": "Больше 1 000 грн чаевых за день",
    "repeat": "day"
  },
  {
    "id": "chainik",
    "name": "Чайник",
    "description": "Больше 2 000 грн чаевых за день",
    "repeat": "day"
  },
  {
    "id": "shlyuha_klienta",
    "name": "Шлюшка клиента",
    "description": "Больше 2 000 грн чаевых одним начислением",
    "repeat": "once"
  },
  {
    "id": "pidaras",
    "name": "Пидарас",
    "description": "Больше 5 000 грн чаевых за день",
    "repeat": "day"
  },
  {
    "id": "otsosal_klientu",
    "name": "Отсосал клиенту",
    "description": "Одним начислением больше 1 000, но не больше 2 000 грн чаевых",
    "repeat": "once"
  },
  {
    "id": "chainaya_imperiya",
    "name": "Чайная империя",
    "description": "30 000 грн чаевых за месяц",
    "repeat": "month"
  },
  {
    "id": "rab_100",
    "name": "Ебать ты раб",
    "description": "Выполнить дневную цель на 100%",
    "repeat": "day"
  },
  {
    "id": "perevypolnil_plan",
    "name": "Перевыполнил план",
    "description": "Выполнить дневную цель на 150%",
    "repeat": "day"
  },
  {
    "id": "bez_ostanovki",
    "name": "Без остановки",
    "description": "Выполнить дневную цель 7 дней подряд",
    "repeat": "day"
  },
  {
    "id": "rab_mesyatsa",
    "name": "Раб месяца",
    "description": "Выполнить месячную цель на 100%",
    "repeat": "month"
  },
  {
    "id": "na_kurazhe",
    "name": "На кураже",
    "description": "Выполнить дневную цель 3 дня подряд",
    "repeat": "day"
  },
  {
    "id": "absolyutny_rab",
    "name": "Абсолютный раб",
    "description": "Выполнить дневную цель 20 дней подряд",
    "repeat": "once"
  },
];
const V3_TITLES = [
  { id: "papa_na_raione", name: "Папа на районе", description: "Лидер месячного заработка" },
  { id: "luchshiy_ponedelnik", name: "Лучший понедельник", description: "Рекорд заработка среди понедельников" },
  { id: "luchshaya_subbota", name: "Лучшая суббота", description: "Рекорд заработка среди суббот" }
];

const V3_SECRET_ACHIEVEMENTS = [
  {
    "id": "tri_topora",
    "name": "Три топора",
    "description": "Ровно 777 грн чаевых за день",
    "secret": true
  },
  {
    "id": "kopeika_k_kopeike",
    "name": "Копейка к копейке",
    "description": "Ровно 1 000 грн заработка за день",
    "secret": true
  },
  {
    "id": "huzhe_zarplaty",
    "name": "Хуже зарплаты",
    "description": "Чаевых за день больше, чем заработка",
    "secret": true
  },
  {
    "id": "kazhdyi_den_kak_nado",
    "name": "Каждый день как надо",
    "description": "Выполнять дневную цель в каждый рабочий день месяца",
    "secret": true
  },
  {
    "id": "novogodniy_yobar",
    "name": "Новогодний ёбарь",
    "description": "Отработать 31 декабря или 1 января",
    "secret": true
  },
  {
    "id": "pyatnitsa_13",
    "name": "Пятница 13-е",
    "description": "Отработать в пятницу 13-го",
    "secret": true
  },
  {
    "id": "zerkalo",
    "name": "Зеркало, блядь",
    "description": "Ровно 2 222 грн заработка за день",
    "secret": true
  },
  {
    "id": "dyavolskiy_den",
    "name": "Дьявольский день",
    "description": "Ровно 666 грн чаевых за день",
    "secret": true
  },
  {
    "id": "utrenniy_yobar",
    "name": "Утренний ёбарь",
    "description": "Выполнить дневную цель до 18:00",
    "secret": true
  },
  {
    "id": "otryv_suka",
    "name": "Отрыв, сука",
    "description": "Заработать вдвое больше второго места за день",
    "secret": true
  },
  {
    "id": "vechnyi_top",
    "name": "Вечный топ",
    "description": "Занимать первое место 10 дней подряд",
    "secret": true
  },
  {
    "id": "bliznetsy",
    "name": "Близнецы",
    "description": "Два дня подряд заработать одинаковую сумму",
    "secret": true
  },
  {
    "id": "tysyachnyi_klient",
    "name": "Тысячный клиент",
    "description": "Получить 1 000-е начисление чаевых",
    "secret": true
  },
  {
    "id": "skromnyaga",
    "name": "Скромняга",
    "description": "Установить дневную цель 1 грн",
    "secret": true
  },
  {
    "id": "mechtatel",
    "name": "Мечтатель, блядь",
    "description": "Установить дневную цель 100 000 грн",
    "secret": true
  },
  {
    "id": "statistik",
    "name": "Статистик",
    "description": "10 раз открыть топ чай, топ неделю, топ месяц, топ день, мой день, моя неделя или мой месяц за день",
    "secret": true
  },
  {
    "id": "bez_plana",
    "name": "Без плана",
    "description": "Отработать смену без установленной дневной цели",
    "secret": true
  },
  {
    "id": "zadrot_bota",
    "name": "Задрот бота",
    "description": "Выполнить 30 распознаваемых команд бота за день",
    "secret": true
  },
  {
    "id": "lentyay",
    "name": "Лентяй, блядь",
    "description": "Не выходить на смену 7 дней после рабочих смен",
    "secret": true
  },
  {
    "id": "filosof",
    "name": "Философ",
    "description": "Изменить дневную цель 10 раз за день",
    "secret": true
  },
  {
    "id": "dyhanie_v_spinu",
    "name": "Дыхание в спину",
    "description": "Отставать от лидера недельного рейтинга менее чем на 500 грн",
    "secret": true
  },
  {
    "id": "fartovaya_grivna",
    "name": "Фартовая гривна",
    "description": "Заработок за день заканчивается на 777",
    "secret": true
  },
  {
    "id": "pervaya_kaplya",
    "name": "Первая капля",
    "description": "Получить первое начисление чаевых",
    "secret": true
  },
  {
    "id": "sotenka",
    "name": "Сотенка",
    "description": "Получить 100 грн чаевых одним начислением",
    "secret": true
  },
  {
    "id": "sotyi_klient",
    "name": "Сотый клиент",
    "description": "Получить 100-е начисление чаевых",
    "secret": true
  },
  {
    "id": "chainyi_fontan",
    "name": "Чайный фонтан",
    "description": "Получить 20 начислений чаевых за день",
    "secret": true
  },
  {
    "id": "dvesti_tysyach_chaya",
    "name": "Двести тысяч чая",
    "description": "Получить 200 000 грн чаевых с начала системы",
    "secret": true
  },
  {
    "id": "million_chaya",
    "name": "Миллион чая",
    "description": "Получить 1 000 000 грн чаевых с начала системы",
    "secret": true
  },
  {
    "id": "peredumal",
    "name": "Передумал",
    "description": "Изменить цель после её выполнения",
    "secret": true
  },
  {
    "id": "luchshe_sebya_vchera",
    "name": "Лучше себя вчерашнего",
    "description": "Зарабатывать больше предыдущего дня 5 дней подряд",
    "secret": true
  },
  {
    "id": "huzhe_no_stabilno",
    "name": "Хуже, но стабильно",
    "description": "Три дня подряд быть на 10% ниже командного среднего",
    "secret": true
  },
  {
    "id": "zolotaya_seredina",
    "name": "Золотая середина",
    "description": "Средний заработок за смену за месяц равен командному среднему",
    "secret": true
  },
  {
    "id": "skachok",
    "name": "Скачок",
    "description": "Заработать за месяц на 50% больше предыдущего месяца",
    "secret": true
  },
  {
    "id": "obval",
    "name": "Обвал, сука",
    "description": "Заработать за месяц на 50% меньше предыдущего месяца",
    "secret": true
  },
  {
    "id": "podem_s_kolen",
    "name": "Подъём с колен",
    "description": "После падения увеличить заработок следующего месяца на 100%",
    "secret": true
  },
  {
    "id": "tot_zhe_den",
    "name": "Тот же день, что и раньше",
    "description": "Повторить заработок дня недельной давности",
    "secret": true
  },
  {
    "id": "eho",
    "name": "Эхо",
    "description": "Повторить заработок того же числа предыдущего месяца",
    "secret": true
  },
  {
    "id": "polsotni",
    "name": "Полсотни",
    "description": "Получить 50 достижений",
    "secret": true
  },
  {
    "id": "sotka_dostizheniy",
    "name": "Сотка достижений",
    "description": "Получить 100 достижений",
    "secret": true
  },
  {
    "id": "sekretnyi_agent",
    "name": "Секретный агент",
    "description": "Открыть 25 скрытых достижений",
    "secret": true
  },
  {
    "id": "tri_za_den",
    "name": "Три за день",
    "description": "Получить 3 достижения за один день",
    "secret": true
  },
  {
    "id": "pyat_za_smenu",
    "name": "Пять за смену",
    "description": "Получить 5 достижений за одну смену",
    "secret": true
  },
  {
    "id": "ohotnik_za_achivkami",
    "name": "Охотник за ачивками",
    "description": "Получать достижение каждый день календарной недели",
    "secret": true
  },
  {
    "id": "vyebannyi_zhiznyu",
    "name": "Выебанный жизнью",
    "description": "Отработать 365 рабочих дней с 19.11.2026",
    "secret": true
  },
  {
    "id": "vernulsya",
    "name": "Вернулся, блядь",
    "description": "Вернуться на смену после перерыва 7 и более дней",
    "secret": true
  },
  {
    "id": "ebanutiiy",
    "name": "Ебанутый",
    "description": "Выполнить дневную цель на 300%",
    "secret": true
  },
  {
    "id": "nahuy_plan",
    "name": "Нахуй план",
    "description": "Выполнить месячную цель на 150%",
    "secret": true
  },
  {
    "id": "dosrochno",
    "name": "Досрочно, сука",
    "description": "Выполнить месячную цель до 20-го числа",
    "secret": true
  },
  {
    "id": "zaebis_tri_raza",
    "name": "Заебись три раза",
    "description": "Выполнить месячную цель 3 месяца подряд",
    "secret": true
  }
];

function v3AchievementDate(award) {
  if(award?.earnedDate) return String(award.earnedDate).slice(0,10);
  if(!award?.earnedAt && /^\d{4}-\d{2}-\d{2}$/.test(String(award?.periodKey||""))) return String(award.periodKey);
  if(!award?.earnedAt) return "";
  const date=new Date(award.earnedAt);
  if(Number.isNaN(date.getTime())) return "";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=type=>parts.find(x=>x.type===type)?.value||"";
  return get("year")+"-"+get("month")+"-"+get("day");
}

function v3AchievementGetMeta(id) {
  return V3_ACHIEVEMENTS.find(x => x.id === id) || V3_SECRET_ACHIEVEMENTS.find(x => x.id === id) || V3_TITLES.find(x => x.id === id);
}

function v3AchievementPeriodKey(repeat, dayISO, weekKey, monthKey) {
  if (repeat === "day") return dayISO;
  if (repeat === "week") return weekKey;
  if (repeat === "month") return monthKey;
  return "all";
}

async function v3AchievementBuildSnapshot() {
  const state = await v3LoadEarningsState();
  const tipsState = await loadTipsState();
  await ensureTipsDay(tipsState);
  const users = new Map();
  const ensureUser = (id, name) => {
    id = String(id);
    if (!users.has(id)) users.set(id,{userId:id,name:name || state.users?.[id]?.name || "Курьер",days:{},maxSingleTip:0});
    if (name) users.get(id).name = name;
    return users.get(id);
  };
  const ensureDay = (user, iso) => {
    if (!user.days[iso]) user.days[iso] = {earnings:0,quests:0,tea:0,total:0};
    if (!Number.isFinite(Number(user.days[iso].quests))) user.days[iso].quests = 0;
    return user.days[iso];
  };
  for (const [dateKey,day] of Object.entries(state.days || {})) {
    const parsed = finalEarningsParseDate(dateKey);
    if (!parsed) continue;
    const iso = finalEarningsISODate(parsed);
    if (iso < V3_ACHIEVEMENT_START_DATE) continue;
    for (const [id,item] of Object.entries(day || {})) {
      if (!item) continue;
      const user = ensureUser(id,item.name);
      const row = ensureDay(user,iso);
      row.earnings += (Number(item.glovo)||0)+(Number(item.bolt)||0)+(Number(item.ipost)||Number(item.iposr)||0)+(Number(item.bolttr)||0)+(Number(item.personal)||0)+(Number(item.floors)||0);
      row.quests += Number(item.quests)||0;
    }
  }
  const tipDays = [];
  if (tipsState.currentDate) tipDays.push({date:tipsState.currentDate,tips:tipsState.today || {}});
  for (const day of tipsState.archive || []) if (day?.date) tipDays.push(day);
  for (const day of tipDays) {
    const parsed = finalEarningsParseDate(day.date);
    if (!parsed) continue;
    const iso = finalEarningsISODate(parsed);
    if (iso < V3_ACHIEVEMENT_START_DATE) continue;
    for (const [id,item] of Object.entries(day.tips || {})) {
      if (!item) continue;
      const user = ensureUser(id,item.name);
      ensureDay(user,iso).tea += Number(item.amount)||0;
    }
  }
  for (const [id,user] of Object.entries(state.users || {})) ensureUser(id,user?.name);
  for (const record of state.records || []) {
    if (!record || record.type !== "tea" || record.canceledAt || String(record.dateKey || "") < V3_ACHIEVEMENT_START_DATE) continue;
    const user = ensureUser(record.userId,record.name);
    user.maxSingleTip = Math.max(user.maxSingleTip,Number(record.amount)||0);
  }
  for (const user of users.values()) {
    for (const row of Object.values(user.days)) row.total = row.earnings + row.tea;
  }
  const today = v3DateISO(finalEarningsToday());
  const todayDate = finalEarningsParseDate(today);
  const monthKey = finalEarningsMonthKey(todayDate);
  const weekKey = finalEarningsWeekKey(todayDate);
  const monthTotals = {};
  for (const [id,user] of users) {
    let weekTotal=0,monthTotal=0,monthTea=0;
    for (const [iso,row] of Object.entries(user.days)) {
      const date=finalEarningsParseDate(iso);
      if (!date) continue;
      if (finalEarningsWeekKey(date)===weekKey) weekTotal+=row.earnings+(Number(row.quests)||0);
      if (finalEarningsMonthKey(date)===monthKey) {monthTotal+=row.earnings+(Number(row.quests)||0);monthTea+=row.tea;}
    }
    monthTotals[id]={total:monthTotal,tea:monthTea};
    user.weekTotal=weekTotal;
    user.monthTotal=monthTotal;
    user.monthTea=monthTea;
    user.today=user.days[today] || {earnings:0,tea:0,total:0};
    user.workDates=Object.keys(user.days).filter(date=>(Number(user.days[date].earnings)||0)+(Number(user.days[date].tea)||0)>0).sort();
    user.workdayCount=user.workDates.length;
    let streak=0;
    const workSet=new Set(user.workDates);
    for(let d=new Date(today+"T00:00:00Z");;d.setUTCDate(d.getUTCDate()-1)){
      const iso=finalEarningsISODate(d);
      if(!workSet.has(iso)) break;
      streak++;
    }
    user.workStreak=streak;
    const monthStart=monthKey+"-01";
    const daysInMonth=new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()+1,0)).getUTCDate();
    user.monthWorkdays=user.workDates.filter(x=>x.startsWith(monthKey+"-")).length;
    user.daysInMonth=daysInMonth;
    user.isMonthEnd=Number(today.slice(8,10))===daysInMonth;
    user.dailyGoalHistory=state.goalHistory?.day?.[id] || {};
    const currentDailyGoal=state.goals?.day?.[id];
    user.todayGoal=currentDailyGoal?.dateKey===today?Number(currentDailyGoal.target)||0:Number(user.dailyGoalHistory?.[today]?.target)||0;
    let goalStreak=0;
    for(let d=new Date(today+"T00:00:00Z");;d.setUTCDate(d.getUTCDate()-1)){
      const iso=finalEarningsISODate(d);
      const target=Number(user.dailyGoalHistory?.[iso]?.target)||(iso===today?user.todayGoal:0);
      const earned=Number(user.days[iso]?.total)||0;
      if(!(target>0) || earned<target) break;
      goalStreak++;
    }
    user.goalStreak=goalStreak;
    const monthGoal=state.goals?.month?.[id];
    user.monthGoal=monthGoal?.periodKey===monthKey?Number(monthGoal.target)||0:0;
    user.monthGoalPercent=user.monthGoal>0?monthTotal/user.monthGoal*100:0;
  }
  const maxMonth = Math.max(0,...Object.values(monthTotals).map(x=>x.total));
  return {state,users,today,monthKey,weekKey,monthTotals,maxMonth};
}

async function v3AchievementGrant(snapshot,userId,achievementId,periodKey,newAwards) {
  const meta=v3AchievementGetMeta(achievementId);
  if(!meta || V3_TITLES.some(x=>x.id===achievementId)) return;
  const state=snapshot.state;
  if(!Array.isArray(state.achievements)) state.achievements=[];
  const awardKey=achievementId+":"+periodKey;
  const alreadyAwarded=state.achievements.some(x=>{
    if(String(x.userId)!==String(userId) || x.achievementId!==achievementId) return false;
    if(meta.repeat==="once" || periodKey==="all") return true;
    return x.awardKey===awardKey || String(x.periodKey||"")===String(periodKey);
  });
  if(alreadyAwarded) return;
  const user=snapshot.users.get(String(userId));
  const award={awardKey,userId:String(userId),name:user?.name||state.users?.[String(userId)]?.name||"Курьер",achievementId,periodKey,earnedAt:new Date().toISOString(),earnedDate:snapshot.today};
  state.achievements.push(award);
  newAwards.push(award);
}

const V3_ACHIEVEMENT_PHASES = {
  instant: new Set(["lentyay","denezhny_dozhd","denezhny_meshok","pervyi_vyhod","trudyaga","bez_otdyha","zhelezny_chelovek","veteran","pervye_500","kasar","chainik","shlyuha_klienta","pidaras","otsosal_klientu","chainaya_imperiya","rab_100","perevypolnil_plan","bez_ostanovki","rab_mesyatsa","na_kurazhe","absolyutny_rab","novogodniy_yobar","pyatnitsa_13","utrenniy_yobar","tysyachnyi_klient","skromnyaga","mechtatel","statistik","zadrot_bota","filosof","pervaya_kaplya","sotenka","sotyi_klient","chainyi_fontan","dvesti_tysyach_chaya","million_chaya","peredumal","kazhdyi_den_kak_nado","vyebannyi_zhiznyu","vernulsya","ebanutiiy","nahuy_plan","dosrochno","zaebis_tri_raza","polsotni","sotka_dostizheniy","sekretnyi_agent","tri_za_den","pyat_za_smenu","ohotnik_za_achivkami"]),
  daily: new Set(["dvushka","korol_smeny","zhirny_kush","tri_topora","kopeika_k_kopeike","huzhe_zarplaty","zerkalo","dyavolskiy_den","otryv_suka","vechnyi_top","bliznetsy","bez_plana","lentyay","fartovaya_grivna","luchshe_sebya_vchera","huzhe_no_stabilno","tot_zhe_den","eho"]),
  weekly: new Set(["dyhanie_v_spinu"]),
  monthly: new Set(["mashina","zolotaya_seredina","skachok","obval"])
};

async function v3EvaluateAchievementsForUser(snapshot,userId,newAwards,phase="instant") {
  const allowed=V3_ACHIEVEMENT_PHASES[phase] || new Set();
  const award=async(id,period)=>{if(allowed.has(id)) await v3AchievementGrant(snapshot,userId,id,period,newAwards);};
  const user=snapshot.users.get(String(userId));
  if(!user) return;
  const dayKey=snapshot.today, weekKey=snapshot.weekKey, monthKey=snapshot.monthKey;
  const todayDate=finalEarningsParseDate(dayKey);
  const daily=user.today.earnings, tea=user.today.tea;
  const goalDaily=user.today.total;
  const workedToday=(Number(user.today.total)||0)>0;
  if(daily>2000) await award("dvushka",dayKey);
  if(daily>10000) await award("korol_smeny",dayKey);
  if(daily>5000) await award("zhirny_kush",dayKey);
  if(user.weekTotal>=50000) await award("denezhny_dozhd",weekKey);
  if(user.monthTotal>=150000) await award("denezhny_meshok",monthKey);
  if(user.workdayCount>=1) await award("pervyi_vyhod","all");
  if(user.workStreak>=7) await award("trudyaga","all");
  if(user.workStreak>=10) await award("bez_otdyha","all");
  if(user.workStreak>=20) await award("zhelezny_chelovek","all");
  if(user.isMonthEnd && user.monthWorkdays===user.daysInMonth) await award("mashina",monthKey);
  if(user.workdayCount>=100) await award("veteran","all");
  const tipRecordsForUser=(snapshot.state.records||[]).filter(x=>x && x.type==="tea" && !x.canceledAt && String(x.userId)===String(userId) && String(x.dateKey||"")>=V3_ACHIEVEMENT_START_DATE);
  if(tipRecordsForUser.some(x=>Number(x.amount)===500)) await award("pervye_500","all");
  if(tea>1000) await award("kasar",dayKey);
  if(tea>2000) await award("chainik",dayKey);
  if(user.maxSingleTip>2000) await award("shlyuha_klienta","all");
  if(tea>5000) await award("pidaras",dayKey);
  if(tipRecordsForUser.some(x=>Number(x.amount)>1000 && Number(x.amount)<=2000)) await award("otsosal_klientu","all");
  if(user.monthTea>=30000) await award("chainaya_imperiya",monthKey);
  const dailyGoal=user.todayGoal;
  const goalPercent=dailyGoal>0?goalDaily/dailyGoal*100:0;
  if(goalPercent>=100) await award("rab_100",dayKey);
  if(goalPercent>=150) await award("perevypolnil_plan",dayKey);
  if(user.goalStreak>=20) await award("absolyutny_rab","all");
  if(user.goalStreak>=7) await award("bez_ostanovki",dayKey);
  if(user.goalStreak>=3) await award("na_kurazhe",dayKey);
  if(user.monthGoal>0 && user.monthGoalPercent>=100) await award("rab_mesyatsa",monthKey);
  // «Папа на районе» теперь хранится как переходящее звание, а не достижение.
  // Скрытые достижения — вычисляются по накопленной истории, но только после даты старта.
  const secretAward = async (id, period) => { if(allowed.has(id)) await v3AchievementGrant(snapshot,userId,id,period || "all",newAwards); };
  const allAwards = snapshot.state.achievements || [];
  const userAwards = allAwards.filter(x=>String(x.userId)===String(userId) && !V3_TITLES.some(t=>t.id===x.achievementId));
  const secretAwards = userAwards.filter(x=>V3_SECRET_ACHIEVEMENTS.some(m=>m.id===x.achievementId));
  const dayRows = Object.entries(user.days).sort((a,b)=>a[0].localeCompare(b[0]));
  const workRows = dayRows.filter(([d,x])=>(Number(x.earnings)||0)+(Number(x.tea)||0)>0);
  const tipRecords = (snapshot.state.records||[]).filter(x=>x && x.type==="tea" && !x.canceledAt && String(x.userId)===String(userId) && String(x.dateKey)>=V3_ACHIEVEMENT_START_DATE);
  const tipTotal = Object.values(user.days).reduce((n,row)=>n+(Number(row.tea)||0),0);
  const tipCount = tipRecords.length;
  const todayTips = tipRecords.filter(x=>x.dateKey===dayKey);

  // Календарные и рейтинговые секреты.
  const dayDate=finalEarningsParseDate(dayKey);
  const weekday=dayDate.getUTCDay();
  const dayOfMonth=dayDate.getUTCDate();
  if((dayKey.endsWith("-12-31") || dayKey.endsWith("-01-01")) && (Number(user.today.total)||0)>0) await secretAward("novogodniy_yobar",dayKey);
  if(weekday===5 && dayOfMonth===13 && (Number(user.today.total)||0)>0) await secretAward("pyatnitsa_13",dayKey);
  const dayRank=[...snapshot.users.values()].map(x=>({id:x.userId,total:Number(x.days?.[dayKey]?.earnings)||0})).sort((a,b)=>b.total-a.total);
  if(dayRank[0]?.id===String(userId) && dayRank[0]?.total>0 && dayRank[1]?.total>0 && dayRank[0].total>=dayRank[1].total*2) await secretAward("otryv_suka",dayKey);
  if(dayRank[0]?.total>0 && Number(user.days?.[dayKey]?.earnings)===dayRank[0].total) {
    let topRun=0;
    for(let n=0;n<10;n++){const d=new Date(dayKey+"T00:00:00Z");d.setUTCDate(d.getUTCDate()-n);const k=finalEarningsISODate(d);const ranking=[...snapshot.users.values()].map(x=>({id:x.userId,total:Number(x.days?.[k]?.earnings)||0})).sort((a,b)=>b.total-a.total);if(ranking[0]?.total>0 && Number(user.days?.[k]?.earnings)===ranking[0].total)topRun++;else break;}
    if(topRun===10) await secretAward("vechnyi_top","all");
  }
  const weekAgo=new Date(dayKey+"T00:00:00Z");weekAgo.setUTCDate(weekAgo.getUTCDate()-7);
  const weekAgoKey=finalEarningsISODate(weekAgo);
  if(daily>0 && user.days[weekAgoKey] && Number(user.days[weekAgoKey].earnings)>0 && daily===user.days[weekAgoKey].earnings) await secretAward("tot_zhe_den",dayKey);
  const monthAgo=new Date(Date.UTC(dayDate.getUTCFullYear(),dayDate.getUTCMonth()-1,dayDate.getUTCDate()));
  const monthAgoKey=finalEarningsISODate(monthAgo);
  if(daily>0 && monthAgoKey>=V3_ACHIEVEMENT_START_DATE && user.days[monthAgoKey] && Number(user.days[monthAgoKey].earnings)>0 && daily===user.days[monthAgoKey].earnings) await secretAward("eho",dayKey);
  // Рекорды по дням недели за всё время новой системы.
  let weekdayRecord=0;
  for(const [date,entry] of Object.entries(user.days)){const dt=finalEarningsParseDate(date);if(dt && dt.getUTCDay()===weekday && (weekday===1||weekday===6)) weekdayRecord=Math.max(weekdayRecord,Number(entry.earnings)||0);}
  // Рекорды понедельников и суббот обрабатываются отдельной системой званий.
  // Командное среднее за день: общий заработок / общее число курьерских смен.
  const dayWorkers=[...snapshot.users.values()].filter(x=>x.workDates.includes(dayKey));
  const teamDayAverage=dayWorkers.length?dayWorkers.reduce((n,x)=>n+(Number(x.days?.[dayKey]?.earnings)||0),0)/dayWorkers.length:0;
  const belowTeamAverage=dayWorkers.length>0 && teamDayAverage>0 && workedToday && daily<=teamDayAverage*0.9;
  let belowRun=belowTeamAverage?1:0;
  if(belowTeamAverage){for(let n=1;n<3;n++){const dt=new Date(dayKey+"T00:00:00Z");dt.setUTCDate(dt.getUTCDate()-n);const k=finalEarningsISODate(dt);const workers=[...snapshot.users.values()].filter(x=>x.workDates.includes(k));const avg=workers.length?workers.reduce((sum,x)=>sum+(Number(x.days?.[k]?.earnings)||0),0)/workers.length:0;const own=Number(user.days?.[k]?.earnings)||0;if(!workers.length||avg<=0||!user.workDates.includes(k)||own>avg*0.9)break;belowRun++;}}
  if(belowRun===3) await secretAward("huzhe_no_stabilno",dayKey);
  // Цель достигнута до 18:00: проверяем время записей заработка за этот день.
  if(dailyGoal>0){
    const timed=(snapshot.state.records||[]).filter(x=>x && !x.canceledAt && String(x.userId)===String(userId) && x.dateKey===dayKey && x.createdAt);
    let sumBefore18=0;
    for(const rec of timed.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))){const dt=new Date(rec.createdAt);const parts=new Intl.DateTimeFormat("en-GB",{timeZone:TIMEZONE,hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(dt);const hh=Number(parts.find(x=>x.type==="hour")?.value);if(hh<18)sumBefore18+=Number(rec.amount)||0;}
    if(sumBefore18>=dailyGoal) await secretAward("utrenniy_yobar",dayKey);
  }
  // Секреты, основанные на изменении дневной цели и активности в боте.
  const activity=snapshot.state.achievementActivity?.[userId]?.[dayKey] || {};
  if((Number(activity.statsOpens)||0)>=10) await secretAward("statistik",dayKey);
  if((Number(activity.commands)||0)>=30) await secretAward("zadrot_bota",dayKey);
  if((Number(activity.goalChanges)||0)>=10) await secretAward("filosof",dayKey);
  if(user.dailyGoalHistory?.[dayKey]?.changedAfterComplete) await secretAward("peredumal",dayKey);
  // Метадостижения считаются по всем обычным и скрытым наградам.
  const awardsToday=userAwards.filter(x=>String(x.periodKey)===dayKey || v3AchievementDate(x)===dayKey);
  const newToday=newAwards.filter(x=>String(x.userId)===String(userId) && (x.periodKey===dayKey || v3AchievementDate(x)===dayKey));
  if(awardsToday.length+newToday.length>=3) await secretAward("tri_za_den",dayKey);
  if(awardsToday.length+newToday.length>=5) await secretAward("pyat_za_smenu",dayKey);
  const weekStart=new Date(dayKey+"T00:00:00Z");weekStart.setUTCDate(weekStart.getUTCDate()-((weekday+6)%7));
  const weekDates=new Set(Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setUTCDate(d.getUTCDate()+i);return finalEarningsISODate(d);}));
  const achievementDays=new Set(userAwards.map(x=>v3AchievementDate(x)).filter(x=>weekDates.has(x)));
  for(const x of newToday) achievementDays.add(dayKey);
  if(achievementDays.size>=7) await secretAward("ohotnik_za_achivkami",weekKey);

  if(tea===777) await secretAward("tri_topora",dayKey);
  if(daily===1000) await secretAward("kopeika_k_kopeike",dayKey);
  if(tea>user.today.earnings) await secretAward("huzhe_zarplaty",dayKey);
  if(daily===2222) await secretAward("zerkalo",dayKey);
  if(tea===666) await secretAward("dyavolskiy_den",dayKey);
  if(daily>0 && daily%1000===777) await secretAward("fartovaya_grivna",dayKey);
  if(tipCount>=1) await secretAward("pervaya_kaplya","all");
  if(tipRecords.some(x=>Number(x.amount)===100)) await secretAward("sotenka","all");
  if(tipCount>=100) await secretAward("sotyi_klient","all");
  if(tipCount>=1000) await secretAward("tysyachnyi_klient","all");
  if(tipTotal>=200000) await secretAward("dvesti_tysyach_chaya","all");
  if(tipTotal>=1000000) await secretAward("million_chaya","all");
  if(todayTips.length>=20) await secretAward("chainyi_fontan",dayKey);
  if(user.workdayCount>=365) await secretAward("vyebannyi_zhiznyu","all");
  if(user.todayGoal===1 || (activity.goalTargets||[]).includes(1)) await secretAward("skromnyaga","all");
  if(user.todayGoal===100000 || (activity.goalTargets||[]).includes(100000)) await secretAward("mechtatel","all");
  if(goalPercent>=300) await secretAward("ebanutiiy",dayKey);
  if(user.monthGoal>0 && user.monthGoalPercent>=150) await secretAward("nahuy_plan",monthKey);
  if(user.monthGoal>0 && user.monthGoalPercent>=100 && Number(dayKey.slice(8,10))<20) await secretAward("dosrochno",monthKey);
  const priorMonthForRecovery=new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()-1,1));
  const priorKeyForRecovery=finalEarningsMonthKey(priorMonthForRecovery);
  const twoMonthsForRecovery=new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()-2,1));
  const twoMonthsKeyForRecovery=finalEarningsMonthKey(twoMonthsForRecovery);
  const monthSumForRecovery=key=>Object.entries(user.days).reduce((sum,[date,row])=>sum+(date.startsWith(key+"-")?((Number(row.earnings)||0)+(Number(row.quests)||0)):0),0);
  const priorSumForRecovery=monthSumForRecovery(priorKeyForRecovery),twoMonthsSumForRecovery=monthSumForRecovery(twoMonthsKeyForRecovery);
  if(priorKeyForRecovery>=V3_ACHIEVEMENT_START_DATE.slice(0,7) && twoMonthsSumForRecovery>0 && priorSumForRecovery>0 && priorSumForRecovery<=twoMonthsSumForRecovery*0.5 && user.monthTotal>=priorSumForRecovery*2) await secretAward("podem_s_kolen",monthKey);
  const everyRecordedWorkdayHasGoal=workRows.filter(([d])=>d.startsWith(monthKey+"-")).every(([d,row])=>Number(user.dailyGoalHistory?.[d]?.target)>0 && row.total>=Number(user.dailyGoalHistory[d].target));
  if(everyRecordedWorkdayHasGoal && user.monthWorkdays>0) await secretAward("kazhdyi_den_kak_nado",monthKey);
  if(user.monthGoal>0 && user.monthGoalPercent>=100) {
    const priorMonth = new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()-1,1));
    const priorKey = finalEarningsMonthKey(priorMonth);
    const twoMonthsAgo = new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()-2,1));
    const twoMonthsKey = finalEarningsMonthKey(twoMonthsAgo);
    const priorDone = allAwards.some(x=>String(x.userId)===String(userId)&&x.achievementId==="rab_mesyatsa"&&x.periodKey===priorKey);
    const twoMonthsDone = allAwards.some(x=>String(x.userId)===String(userId)&&x.achievementId==="rab_mesyatsa"&&x.periodKey===twoMonthsKey);
    if(priorDone && twoMonthsDone) await secretAward("zaebis_tri_raza",monthKey);
  }
  if(user.isMonthEnd && user.monthWorkdays>0) {
    const teamWorkdays=[...snapshot.users.values()].reduce((n,u)=>n+(u.monthWorkdays||0),0);
    const teamEarnings=[...snapshot.users.values()].reduce((n,u)=>n+(u.monthTotal||0),0);
    const teamAvg=teamWorkdays?teamEarnings/teamWorkdays:0;
    const personalAvg=user.monthWorkdays?user.monthTotal/user.monthWorkdays:0;
    if(teamAvg>0 && Math.round(personalAvg*100)===Math.round(teamAvg*100)) await secretAward("zolotaya_seredina",monthKey);
    const priorMonth = new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()-1,1));
    const priorKey=finalEarningsMonthKey(priorMonth);
    const twoMonthsAgo = new Date(Date.UTC(todayDate.getUTCFullYear(),todayDate.getUTCMonth()-2,1));
    const twoMonthsKey = finalEarningsMonthKey(twoMonthsAgo);
    const monthEarnings = key => Object.entries(user.days).reduce((sum,[date,row])=>sum+(date.startsWith(key+"-")?((Number(row.earnings)||0)+(Number(row.quests)||0)):0),0);
    const priorTotal=monthEarnings(priorKey),twoMonthsTotal=monthEarnings(twoMonthsKey);
    if(priorKey>=V3_ACHIEVEMENT_START_DATE.slice(0,7) && priorTotal>0 && user.monthTotal>=priorTotal*1.5) await secretAward("skachok",monthKey);
    if(priorKey>=V3_ACHIEVEMENT_START_DATE.slice(0,7) && priorTotal>0 && user.monthTotal<=priorTotal*0.5) await secretAward("obval",monthKey);
    // «Подъём с колен» проверяется сразу при достижении порога.
    const everyWorkdayHasGoal=workRows.filter(([d])=>d.startsWith(monthKey+"-")).every(([d,row])=>Number(user.dailyGoalHistory?.[d]?.target)>0 && row.total>=Number(user.dailyGoalHistory[d].target));
    if(everyWorkdayHasGoal && user.monthWorkdays>0) await secretAward("kazhdyi_den_kak_nado",monthKey);
  }
  const yesterday=new Date(dayKey+"T00:00:00Z");yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const yISO=finalEarningsISODate(yesterday);
  if(daily>0 && Number(user.days[yISO]?.earnings)>0 && daily===user.days[yISO].earnings) await secretAward("bliznetsy",dayKey);
  if(user.days[yISO] && daily>user.days[yISO].earnings) {
    let rising=1,cur=new Date(dayKey+"T00:00:00Z");
    for(let j=1;j<5;j++){cur.setUTCDate(cur.getUTCDate()-1);const d=finalEarningsISODate(cur);const p=new Date(cur);p.setUTCDate(p.getUTCDate()-1);const prev=finalEarningsISODate(p);if((user.days[d]?.earnings||0)>(user.days[prev]?.earnings||0))rising++;else break;}
    if(rising===5) await secretAward("luchshe_sebya_vchera",dayKey);
  }
  if(user.workStreak>=365) await secretAward("vyebannyi_zhiznyu","all");
  {
    const priorWorks=user.workDates.filter(d=>d<dayKey);
    const lastPrior=priorWorks[priorWorks.length-1];
    const gap=lastPrior?Math.round((Date.parse(dayKey+"T00:00:00Z")-Date.parse(lastPrior+"T00:00:00Z"))/86400000):0;
    if(lastPrior && workedToday && gap>=8) await secretAward("vernulsya",dayKey);
    if(lastPrior && !workedToday && gap>=7) await secretAward("lentyay",dayKey);
  }
  if(workedToday && !Number(user.todayGoal)) await secretAward("bez_plana",dayKey);
  if(user.weekTotal>0) {
    const sorted=[...snapshot.users.values()].map(x=>({id:x.userId,total:x.weekTotal||0})).sort((a,b)=>b.total-a.total);
    if(sorted[0]?.id!==String(userId) && sorted[0]?.total-(user.weekTotal||0)<500 && sorted[0]?.total>(user.weekTotal||0)) await secretAward("dyhanie_v_spinu",weekKey);
  }
  const pendingAwards=newAwards.filter(x=>String(x.userId)===String(userId));
  const totalAwards=userAwards.length+pendingAwards.filter(x=>!userAwards.some(a=>a.awardKey===x.awardKey)).length;
  const totalSecret=secretAwards.length+pendingAwards.filter(x=>V3_SECRET_ACHIEVEMENTS.some(m=>m.id===x.achievementId)&&!userAwards.some(a=>a.awardKey===x.awardKey)).length;
  if(totalAwards>=50) await secretAward("polsotni","all");
  if(totalAwards>=100) await secretAward("sotka_dostizheniy","all");
  if(totalSecret>=25) await secretAward("sekretnyi_agent","all");

}

async function v3CheckAchievements(userId,recheckFinalizedPeriods=false) {
  const snapshot=await v3AchievementBuildSnapshot();
  const newAwards=[];
  if(snapshot.state.achievementsEnabled!==false){
    await v3EvaluateAchievementsForUser(snapshot,String(userId),newAwards,"instant");
    if(recheckFinalizedPeriods){
      for(const phase of ["daily","weekly","monthly"]){
        const marker="achievements:"+phase+":"+snapshot.today;
        if(snapshot.state.v3Sent?.[marker]) await v3EvaluateAchievementsForUser(snapshot,String(userId),newAwards,phase);
      }
    }
  }
  const titleEvents=v3EvaluateTitles(snapshot,"instant");
  if(!newAwards.length && !titleEvents.length)return;
  await finalEarningsSave(snapshot.state);
  await v3SendAchievementAwards(newAwards);
  await v3NotifyTitleEvents(titleEvents);
}

async function v3SendAchievementAwards(newAwards) {
  if(!newAwards.length)return;
  let groupChatId=null;
  try{const chat=await db.collection("courier-session-booking").findOne({key:"main"});groupChatId=chat?.data?.lastGroupChatId||null;}
  catch(error){console.error("V3 achievement group lookup:",error.message);}
  if(!groupChatId)return;
  for(const item of newAwards){
    const meta=v3AchievementGetMeta(item.achievementId),isSecret=!!meta?.secret;
    const message="🏆 НОВОЕ ДОСТИЖЕНИЕ!\n\n"+(isSecret?"🟣 СЕКРЕТНОЕ ДОСТИЖЕНИЕ РАСКРЫТО!\n\n":"🟡 ОБЫЧНОЕ ДОСТИЖЕНИЕ\n\n")+
      "🔥 "+String(item.name||"Курьер").toUpperCase()+" ПОЛУЧАЕТ: «"+(meta?.name||item.achievementId).toUpperCase()+"»\n\n"+
      (meta?.description||"Так держать!")+"\n\nЕщё один день, когда этот ублюдок доказал, что остальные просто массовка. 💸🔥";
    try{await bot.telegram.sendMessage(groupChatId,message);}
    catch(error){console.error("V3 achievement group notification:",groupChatId,error.message);}
  }
}

function v3EvaluateTitles(snapshot,phase) {
  const state=snapshot.state;
  state.titles=state.titles||{};
  const events=[];
  const setTitle=(id,value,holders,periodKey,resetPeriod=false)=>{
    const old=state.titles[id]||{recordValue:0,holders:[]};
    if(!(value>0)){
      if(resetPeriod && state.titles[id] && (old.periodKey!==periodKey || Number(old.recordValue||0)>0)){
        state.titles[id]={recordValue:0,holders:[],periodKey,updatedAt:new Date().toISOString()};
        if((old.holders||[]).length){const meta=V3_TITLES.find(x=>x.id===id);events.push({id,name:meta?.name||id,value:0,holders:[],periodKey});}
      }
      return;
    }
    let next;
    if(resetPeriod || value>Number(old.recordValue||0)){
      next={recordValue:value,holders,periodKey,updatedAt:new Date().toISOString()};
    }else if(value===Number(old.recordValue||0)){
      const map=new Map((old.holders||[]).map(x=>[String(x.userId),x]));
      for(const h of holders)map.set(String(h.userId),h);
      next={...old,holders:[...map.values()]};
    }else return;
    const before=(old.holders||[]).map(x=>String(x.userId)).sort().join(",");
    const after=next.holders.map(x=>String(x.userId)).sort().join(",");
    const periodChanged=resetPeriod && old.periodKey!==periodKey;
    state.titles[id]=next;
    if(before!==after || periodChanged){
      const meta=V3_TITLES.find(x=>x.id===id);
      events.push({id,name:meta?.name||id,value,holders:next.holders,periodKey});
    }
  };
  if(["instant","daily","monthly"].includes(phase)){
    const value=snapshot.maxMonth;
    const holders=[...snapshot.users.values()].filter(x=>x.monthTotal===value&&value>0).map(x=>({userId:x.userId,name:x.name}));
    setTitle("papa_na_raione",value,holders,snapshot.monthKey,true);
  }
  if(["instant","daily"].includes(phase)){
    for(const [weekday,id] of [[1,"luchshiy_ponedelnik"],[6,"luchshaya_subbota"]]){
      let value=0;
      const holderMap=new Map();
      for(const user of snapshot.users.values()){
        for(const [date,row] of Object.entries(user.days)){
          const dateValue=finalEarningsParseDate(date);
          if(!dateValue || dateValue.getUTCDay()!==weekday)continue;
          const earnings=Number(row.earnings)||0;
          if(earnings>value){value=earnings;holderMap.clear();if(earnings>0)holderMap.set(String(user.userId),{userId:user.userId,name:user.name});}
          else if(earnings>0 && earnings===value)holderMap.set(String(user.userId),{userId:user.userId,name:user.name});
        }
      }
      setTitle(id,value,[...holderMap.values()],"all",true);
    }
  }
  return events;
}

async function v3NotifyTitleEvents(events) {
  if(!events.length)return;
  let chatId=null;
  try{const chat=await db.collection("courier-session-booking").findOne({key:"main"});chatId=chat?.data?.lastGroupChatId||null;}
  catch(error){console.error("V3 title lookup:",error.message);}
  if(!chatId)return;
  for(const event of events){
    const names=event.holders.length?event.holders.map(x=>x.name||"Курьер").join(", "):"Пока нет обладателя";
    const message="👑 ЗВАНИЕ ОБНОВЛЕНО!\n\n🏆 "+event.name.toUpperCase()+"\n\n"+names+(event.value>0?"\n\nРезультат: "+event.value+" грн":"")+
      (event.holders.length>1?"\n🤝 Одинаковый результат — звание у всех лидеров.":"");
    try{await bot.telegram.sendMessage(chatId,message);}
    catch(error){console.error("V3 title notification:",error.message);}
  }
}

async function v3CheckChatAchievement(ctx) {
  if(!ctx?.from?.id || !ctx.chat || !["group","supergroup"].includes(ctx.chat.type))return;
  const raw=String(ctx.message?.text||"").trim();
  if(!raw || raw.startsWith("/"))return;
  const state=await v3LoadEarningsState();
  if(state.achievementsEnabled===false)return;
  const userId=String(ctx.from.id);
  if((state.achievements||[]).some(x=>String(x.userId)===userId&&x.achievementId==="znakomstvo_s_chatom"))return;
  state.users=state.users||{};
  state.users[userId]=state.users[userId]||{name:getTelegramDisplayName(ctx)};
  const snapshot={state,users:new Map([[userId,{userId,name:getTelegramDisplayName(ctx)}]]),today:v3DateISO(finalEarningsToday())};
  const newAwards=[];
  await v3AchievementGrant(snapshot,userId,"znakomstvo_s_chatom","all",newAwards);
  if(newAwards.length){await finalEarningsSave(state);await v3SendAchievementAwards(newAwards);}
}

const v3AchievementRunLocks = new Set();

async function v3EvaluateAllAchievements(phase="daily") {
  const todayKey = v3DateISO(finalEarningsToday());
  const runKey = "achievements:"+phase+":"+todayKey;
  if(v3AchievementRunLocks.has(runKey)) return;
  v3AchievementRunLocks.add(runKey);
  try {
    const snapshot=await v3AchievementBuildSnapshot();
    const marker="achievements:"+phase+":"+snapshot.today;
    if(snapshot.state.v3Sent?.[marker])return;
    if(!snapshot.state.v3Sent)snapshot.state.v3Sent={};
    const newAwards=[];
    if(snapshot.state.achievementsEnabled!==false){
      for(const userId of snapshot.users.keys())await v3EvaluateAchievementsForUser(snapshot,userId,newAwards,phase);
    }
    const titleEvents=v3EvaluateTitles(snapshot,phase);
    snapshot.state.v3Sent[marker]=true;
    await finalEarningsSave(snapshot.state);
    await v3SendAchievementAwards(newAwards);
    await v3NotifyTitleEvents(titleEvents);
  } finally {
    v3AchievementRunLocks.delete(runKey);
  }
}

bot.hears(/^мои достижения$/i,async ctx=>{
  const state=await v3LoadEarningsState();
  const mine=(state.achievements||[]).filter(x=>String(x.userId)===String(ctx.from.id)&&!V3_TITLES.some(t=>t.id===x.achievementId)).sort((a,b)=>String(b.earnedAt).localeCompare(String(a.earnedAt)));
  if(!mine.length && !Object.values(state.titles||{}).some(t=>(t.holders||[]).some(h=>String(h.userId)===String(ctx.from.id)))) return ctx.reply("🏆 ТВОИ ДОСТИЖЕНИЯ\n\nПока нет полученных наград. Выполняй условия — бот сообщит, когда появится первое достижение.");
  const lines=mine.map((x,i)=>{const meta=v3AchievementGetMeta(x.achievementId);return (i+1)+". 🏅 "+(meta?.name||x.achievementId)+" — "+v3AchievementDate(x)+(meta?.repeat==="day"||meta?.repeat==="week"||meta?.repeat==="month"?" ("+x.periodKey+")":"");});
  const titles=Object.entries(state.titles||{}).filter(([id,t])=>(t.holders||[]).some(h=>String(h.userId)===String(ctx.from.id))).map(([id,t])=>"👑 "+(V3_TITLES.find(x=>x.id===id)?.name||id)+(t.periodKey?" — "+t.periodKey:""));
  await ctx.reply("🏆 МОИ ДОСТИЖЕНИЯ ("+mine.length+")\n━━━━━━━━━━━━━━\n"+lines.join("\n")+(titles.length?"\n\n👑 ЗВАНИЯ\n"+titles.join("\n"):""));
});

bot.hears(/^достижения$/i,async ctx=>{
  const state=await v3LoadEarningsState();
  const earned=(state.achievements||[]).filter(x=>String(x.userId)===String(ctx.from.id));
  const ordinary=V3_ACHIEVEMENTS.map((x,i)=>{const a=earned.filter(y=>y.achievementId===x.id).sort((u,v)=>String(v.earnedAt).localeCompare(String(u.earnedAt)))[0];return (i+1)+". "+(a?"🟡":"⚫")+" "+x.name+(a?" — "+v3AchievementDate(a):"");});
  const hidden=V3_SECRET_ACHIEVEMENTS.filter(x=>earned.some(a=>a.achievementId===x.id)).length;
  const keyboard={inline_keyboard:V3_ACHIEVEMENTS.map(x=>[{text:(earned.some(a=>a.achievementId===x.id)?"🏅 ":"🔒 ")+x.name,callback_data:"v3_ach_"+x.id}]).concat([[{text:"🟣 Скрытые достижения ("+hidden+"/"+V3_SECRET_ACHIEVEMENTS.length+")",callback_data:"v3_ach_hidden"}]])};
  const titleLines=Object.entries(state.titles||{}).filter(([id,t])=>(t.holders||[]).length>0).map(([id,t])=>{const meta=V3_TITLES.find(x=>x.id===id);return meta?"👑 "+meta.name+": "+(t.holders||[]).map(h=>h.name).join(", "):null;}).filter(Boolean);
  await ctx.reply("🏆 ДОСТИЖЕНИЯ\n━━━━━━━━━━━━━━\n🟡 ОБЫЧНЫЕ ("+earned.filter(a=>V3_ACHIEVEMENTS.some(x=>x.id===a.achievementId)).length+"/"+V3_ACHIEVEMENTS.length+")\n"+ordinary.join("\n")+"\n\n🟣 Скрытые: "+hidden+"/"+V3_SECRET_ACHIEVEMENTS.length+"\nНераскрытые секреты не показываются."+(titleLines.length?"\n\n👑 ЗВАНИЯ\n"+titleLines.join("\n"):""),{reply_markup:keyboard});
});
bot.action("v3_ach_hidden",async ctx=>{
  const state=await v3LoadEarningsState(),mine=(state.achievements||[]).filter(x=>String(x.userId)===String(ctx.from.id));
  const count=mine.filter(a=>V3_SECRET_ACHIEVEMENTS.some(x=>x.id===a.achievementId)).length;
  await ctx.answerCbQuery("Скрытые достижения: "+count+"/"+V3_SECRET_ACHIEVEMENTS.length);
  const unlocked=mine.filter(a=>V3_SECRET_ACHIEVEMENTS.some(x=>x.id===a.achievementId)).sort((a,b)=>String(a.earnedAt).localeCompare(String(b.earnedAt)));
  const rows=unlocked.map((a,i)=>{const m=v3AchievementGetMeta(a.achievementId);return (i+1)+". 🟣 "+m.name+" — "+v3AchievementDate(a);});
  await ctx.reply("🟣 СЕКРЕТНЫЕ ДОСТИЖЕНИЯ\n━━━━━━━━━━━━━━\nСкрытые: "+count+"/"+V3_SECRET_ACHIEVEMENTS.length+"\n\n"+(rows.length?rows.join("\n"):"Пока ни одно не раскрыто.")+"\n\nОстальные условия останутся тайной до выполнения.");
});
bot.action(/^v3_ach_([a-z0-9_]+)$/,async ctx=>{
  const id=ctx.match[1],meta=v3AchievementGetMeta(id);
  if(!meta || meta.secret){await ctx.answerCbQuery("Это секретная награда");return;}
  const state=await v3LoadEarningsState(),award=(state.achievements||[]).find(x=>String(x.userId)===String(ctx.from.id)&&x.achievementId===id);
  await ctx.answerCbQuery();
  await ctx.reply("🏅 "+meta.name+"\n\n"+meta.description+"\n\nСтатус: "+(award?"Получено ✅":"Пока не получено ⚫")+(award?"\nДата: "+v3AchievementDate(award):""));
});

bot.hears(/^топ достижений$/i,async ctx=>{
  const state=await v3LoadEarningsState();
  const counts={};
  for(const award of state.achievements||[]){
    if(V3_TITLES.some(t=>t.id===award.achievementId))continue;
    const id=String(award.userId);
    if(!counts[id]) counts[id]={name:award.name||state.users?.[id]?.name||"Курьер",count:0};
    counts[id].count++;
  }
  const rows=Object.entries(counts).sort((a,b)=>b[1].count-a[1].count||a[1].name.localeCompare(b[1].name)).slice(0,10);
  await ctx.reply("🏆 ТОП ДОСТИЖЕНИЙ\n━━━━━━━━━━━━━━\n"+(rows.length?rows.map((x,i)=>(i+1)+". "+x[1].name+" — "+x[1].count).join("\n"):"Пока никто не получил достижения."));
});

// Сохраняем дневную цель по каждому дню — это нужно для серий выполненных планов.
const v3OriginalSetDailyGoal = finalEarningsSetGoal;
finalEarningsSetGoal = async function(ctx,period,amount){
  await v3OriginalSetDailyGoal(ctx,period,amount);
  await v3CheckAchievements(String(ctx.from.id));
};

// ============================================================
// V3 ADMIN PANEL — доступ только ADMIN_IDS
// ============================================================

function v3AdminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 Общая статистика", callback_data: "v3_admin_stats" }],
      [{ text: "🎯 Цели курьеров", callback_data: "v3_admin_goals" }],
      [{ text: "👥 Пользователи", callback_data: "v3_admin_users" }],
      [{ text: "📜 История изменений", callback_data: "v3_admin_history" }],
      [{ text: "🏅 Настройки достижений", callback_data: "v3_admin_achievements" }],
      [{ text: "⏰ Напоминания", callback_data: "v3_admin_reminders" }],
      [{ text: "⚙️ Параметры бота", callback_data: "v3_admin_settings" }]
    ]
  };
}

async function v3AdminShow(ctx, section = "menu", edit = false) {
  if (!isAdmin(ctx)) {
    if (ctx.answerCbQuery) await ctx.answerCbQuery("Нет доступа");
    else await ctx.reply("Нет доступа ❌");
    return;
  }
  let text = "🛠 АДМИН-ПАНЕЛЬ\n━━━━━━━━━━━━━━";
  let keyboard = v3AdminKeyboard();
  const state = await v3LoadEarningsState();
  if (section === "stats") {
    const today = await finalEarningsBuildDay(finalEarningsToday());
    const week = await finalEarningsPeriodEntriesForKey("week", finalEarningsWeekKey(finalEarningsParseDate(finalEarningsToday())), state);
    const month = await finalEarningsPeriodEntriesForKey("month", finalEarningsMonthKey(finalEarningsParseDate(finalEarningsToday())), state);
    const sum = rows => rows.reduce((n,x) => n + (Number(x.total)||0),0);
    text += "\n\n📊 ОБЩАЯ СТАТИСТИКА\nСегодня: " + sum(today) + " грн (" + today.length + " кур.)\nНеделя: " + sum(week) + " грн (" + week.length + " кур.)\nМесяц: " + sum(month) + " грн (" + month.length + " кур.)";
  } else if (section === "goals") {
    const dateKey = v3DateISO(finalEarningsToday());
    const lines = [];
    for (const [id,goal] of Object.entries(state.goals.day || {})) {
      if (goal?.dateKey !== dateKey) continue;
      const name = state.users?.[id]?.name || id;
      const report = await finalEarningsReport(id,dateKey);
      lines.push(name + " — " + report.total + "/" + goal.target + " грн (" + Math.round(report.total/goal.target*100) + "%)");
    }
    text += "\n\n🎯 ЦЕЛИ НА СЕГОДНЯ\n" + (lines.length ? lines.join("\n") : "Дневные цели пока не установлены.");
    text += "\n\nНедельные и месячные цели сохраняются в своих разделах статистики.";
  } else if (section === "achievements") {
    text += "\n\n🏅 ДОСТИЖЕНИЯ\nСтатус: " + (state.achievementsEnabled === false ? "выключены" : "включены") + "\nВсего награждений: " + (state.achievements || []).length + "\nВсего видов: " + V3_ACHIEVEMENTS.length;
    keyboard = { inline_keyboard: [[{ text: state.achievementsEnabled === false ? "▶️ Включить достижения" : "⏸ Выключить достижения", callback_data: "v3_admin_achievements_toggle" }],[{ text: "⬅️ В админ-панель", callback_data: "v3_admin_menu" }]] };
  } else if (section === "users") {
    const users = Object.entries(state.users || {});
    text += "\n\n👥 ПОЛЬЗОВАТЕЛИ (" + users.length + ")\n" + (users.length ? users.slice(0,50).map(([id,u],i)=>(i+1)+". "+(u?.name||"Без имени")+" — "+id).join("\n") : "Пользователей пока нет.");
  } else if (section === "history") {
    const rows = (state.audit || []).slice(-20).reverse();
    text += "\n\n📜 ПОСЛЕДНИЕ ОПЕРАЦИИ\n" + (rows.length ? rows.map(x=>(x.action==="cancel"?"❌ отмена":x.action==="reset"?"♻️ сброс":"➕ добавление")+" — "+(x.name||x.userId)+": "+x.amount+" грн ("+x.type+")").join("\n") : "История пока пуста.");
  } else if (section === "reminders") {
    text += "\n\n⏰ НАПОМИНАНИЯ\nЧасовой пояс: Europe/Kyiv\nДействующие автоматические напоминания сохранены без изменений.\nИзменение их расписания через панель пока не включено.";
  } else if (section === "settings") {
    text += "\n\n⚙️ ПАРАМЕТРЫ БОТА\nЧасовой пояс: " + TIMEZONE + "\nАдминистраторы: " + ADMIN_IDS.join(", ") + "\nЧат(ы) дневных отчётов: " + ([...(state.goalReportChatIds||[]),state.goalReportChatId].filter(Boolean).join(", ") || "не настроены") + "\nЛимит таблицы: " + MAX_PEOPLE_PER_DAY + " человека в день.";
  }
  if (section !== "menu" && section !== "achievements") keyboard = { inline_keyboard: [[{ text: "⬅️ В админ-панель", callback_data: "v3_admin_menu" }]] };
  if (edit) {
    try { await ctx.editMessageText(text,{reply_markup:keyboard}); }
    catch { await ctx.reply(text,{reply_markup:keyboard}); }
  } else {
    await ctx.reply(text,{reply_markup:keyboard});
  }
}

bot.hears(/^апанель$/i, async ctx => v3AdminShow(ctx,"menu",false));
bot.action("v3_admin_achievements_toggle",async ctx=>{
  if(!isAdmin(ctx)){await ctx.answerCbQuery("Нет доступа");return;}
  const state=await v3LoadEarningsState();
  state.achievementsEnabled=state.achievementsEnabled===false;
  await finalEarningsSave(state);
  await ctx.answerCbQuery(state.achievementsEnabled?"Достижения включены":"Достижения выключены");
  await v3AdminShow(ctx,"achievements",true);
});

bot.action(/^v3_admin_(menu|stats|goals|users|history|reminders|settings|achievements)$/, async ctx => {
  try {
    await ctx.answerCbQuery();
    await v3AdminShow(ctx,ctx.match[1],true);
  } catch (error) {
    console.error("V3 ADMIN PANEL:",error);
    try { await ctx.answerCbQuery("Ошибка ❌"); } catch {}
  }
});
