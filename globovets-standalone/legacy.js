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

  if (!state.codes) {
    state.codes = {};
  }

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
        text += `  ${index + 1}. ${person}\n`;
      });
    }

    text += "\n";
  }

  text += "━━━━━━━━━━━━━━";

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
// 🎭 ВЫБОР РЕАКЦИИ ПО СУММЕ ЧАЕВЫХ
// ============================================================

function tipMemeGetReaction(amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  if (amount >= 1 && amount <= 19) {
    return {
      type: "text",
      value: "Окак"
    };
  }

  if (amount === 20) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHhFtqyl0FlOGmVUemGaql6sk7bp8NDwACeQADSEIXFSOp6962d-IkPQQ"
    };
  }

  if (amount >= 21 && amount <= 49) {
    return {
      type: "text",
      value: "Ебать ты пидарас"
    };
  }

  if (amount === 50) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHhF1qyl5FZPY11Bg3gn03-yMnOSvrkQACegADSEIXFZFMbwrxNkmIPQQ"
    };
  }

  if (amount >= 51 && amount <= 66) {
    return {
      type: "text",
      value: "Пидарас ПИДАРАСИНА"
    };
  }

  if (amount === 67) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHhGZqyl7_NrUmvHGF1wE8ydD1PQrPHgAC4FAAAibK-EhrJ_etcJUkIj0E"
    };
  }

  if (amount === 68) {
    return {
      type: "text",
      value: "Пидарас ПИДАРАСИНА"
    };
  }

  if (amount === 69) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHhYBqyq_5Dru31yUFuHkyHJbiuKiQ6AACNVcAAlBikEgtHLdRiZqfiD0E"
    };
  }

  if (amount >= 70 && amount <= 98) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHh9xqy2KhfYOEpZqtH4UgjIq58f0R8QAC8FwAAlij4EtZh7WuEivoiT0E"
    };
  }

  if (amount === 99) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHh-Bqy2K4FmBeQfjVLiU1esPnYIVQlQACZhoAAvHiWUt0fLpq5fnd2j0E"
    };
  }

  if (amount === 100) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHh-Rqy2Lg1mLSmeCtcYvSxEaDaPMCggAC0AAD5Z4_F2AxcRsPXHqcPQQ"
    };
  }

  if (amount > 100) {
    return {
      type: "sticker",
      value: "CAACAgIAAxkBAAEHh-Zqy2MgQI4v3fVaYA4anZrfXx3b_gACI20AAkY4iEpf_o-odLiM6z0E"
    };
  }

  return null;
}


// ============================================================
// ☕ ЧАЙ + СУММА
//
// Этот обработчик также сохраняет чаевые в старую статистику.
// Он заменяет старый обработчик для совпадающих сообщений,
// поэтому сумма не будет записываться дважды.
// ============================================================

bot.hears(
  /^\s*чай\s*\+\s*(\d+(?:[.,]\d+)?)\s*$/i,
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

// ============================================================
// ЧАЙ +50
// ============================================================

bot.hears(
  /^чай\s*\+\s*(\d+(?:[.,]\d+)?)$/i,
  async ctx => {
    try {
      const amount =
        Number(
          ctx.match[1]
            .replace(",", ".")
        );

      if (
        !Number.isFinite(amount) ||
        !Number.isInteger(amount) ||
        amount <= 0
      ) {
        await ctx.reply(
          "Сумма должна быть целым числом больше 0 ❌"
        );

        return;
      }

      if (
        amount > 100000
      ) {
        await ctx.reply(
          "Слишком большая сумма ❌"
        );

        return;
      }

      const state =
        await loadTipsState();

      await ensureTipsDay(
        state
      );

      const userId =
        String(ctx.from.id);

      const name =
        getTelegramDisplayName(
          ctx
        );

      if (
        !state.today[userId]
      ) {
        state.today[userId] = {
          name,
          amount: 0
        };
      }

      state.today[userId].name =
        name;

      state.today[userId].amount +=
        amount;

      await saveTipsState(
        state
      );

      const total =
        state.today[userId]
          .amount;

      await ctx.reply(
        `☕ ${name} +${amount} грн\n` +
        `💰 Всего сегодня: ${total} грн`
      );
    } catch (error) {
      console.error(
        "TIPS ADD ERROR:",
        error
      );

      await ctx.reply(
        "Ошибка добавления чаевых ❌\n\n" +
        String(error.message || error)
      );
    }
  }
);


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
                  "https://send.monobank.ua/jar/8vUbn19szV"
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
      "/u Имя — убрать сегодня\n" +
      "/u пт Имя — убрать с пятницы\n" +
      "/ah — архив таблицы\n\n" +

      "ЧАЕВЫЕ:\n" +
      "/tips — чаевые за сегодня\n" +
      "Чай +50 — добавить себе 50 грн\n" +
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
  "Теперь бот не улетит и не будет лагать из-за блекаутов! ⚡\n\n" +
  "Также хочу напомнить, что он полностью оккупировал мой ноутбук 😅, " +
  "так что, если не жалко копеечку, закинь на банку ❤️";


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
// БРОНИРОВАНИЕ СЕССИЙ — АВТОМАТИЧЕСКОЕ УВЕДОМЛЕНИЕ
// Отдельный блок — вставить в самый низ файла
// ============================================================

const SESSION_BOOKING_DB_COLLECTION = "courier-session-booking";
const SESSION_BOOKING_DB_KEY = "main";

const SESSION_BOOKING_TEXT =
  '🚨🔥🚨🔥🚨\n\n' +
  '<b>БРОНИРОВАНИЕ СЕССИЙ НАЧАЛОСЬ</b>\n\n' +
  '📢 @Invisiibllee\n' +
  '📢 @Aleksandr111020\n' +
  '📢 @smurf1108\n\n' +
  '⚡🏍️🔥 Бронируем сессии! 🔥🏍️⚡\n\n' +
  '🚨🔥🚨🔥🚨';


// ------------------------------------------------------------
// Получаем текущее время по Киеву
// ------------------------------------------------------------

function getKyivDateTimeForSessions() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now);

  const result = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
  }

  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
    second: Number(result.second)
  };
}


// ------------------------------------------------------------
// Ключ текущей даты по Киеву
// ------------------------------------------------------------

function getKyivDateKeyForSessions() {
  const t = getKyivDateTimeForSessions();

  return (
    String(t.year) +
    '-' +
    String(t.month).padStart(2, '0') +
    '-' +
    String(t.day).padStart(2, '0')
  );
}


// ------------------------------------------------------------
// Запоминаем последний групповой чат
// ------------------------------------------------------------

async function rememberLastGroupForSessions(ctx) {
  try {
    if (!ctx || !ctx.chat) return;

    const chatType = ctx.chat.type;

    // Только группы и супергруппы
    if (chatType !== 'group' && chatType !== 'supergroup') {
      return;
    }

    const chatId = ctx.chat.id;

    const existing = await db
      .collection(SESSION_BOOKING_DB_COLLECTION)
      .findOne({ key: SESSION_BOOKING_DB_KEY });

    const oldData = existing && existing.data
      ? existing.data
      : {};

    const newData = {
      ...oldData,
      lastGroupChatId: chatId,
      lastGroupChatTitle: ctx.chat.title || '',
      updatedAt: new Date().toISOString()
    };

    await db
      .collection(SESSION_BOOKING_DB_COLLECTION)
      .updateOne(
        { key: SESSION_BOOKING_DB_KEY },
        {
          $set: {
            key: SESSION_BOOKING_DB_KEY,
            data: newData,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

  } catch (error) {
    console.error(
      'Ошибка сохранения последнего группового чата:',
      error.message
    );
  }
}


// ------------------------------------------------------------
// Проверяем и отправляем сообщение о бронировании
// ------------------------------------------------------------

async function checkSessionBookingNotification() {
  try {
    const time = getKyivDateTimeForSessions();

    // 4 = четверг
    // JS: 0 воскресенье, 1 понедельник ... 4 четверг
    const jsDay = new Date(
      Date.UTC(
        time.year,
        time.month - 1,
        time.day
      )
    ).getUTCDay();

    if (jsDay !== 4) {
      return;
    }

    // Окно 14:00–14:00:59
    if (time.hour !== 14 || time.minute !== 0) {
      return;
    }

    const dateKey = getKyivDateKeyForSessions();

    const existing = await db
      .collection(SESSION_BOOKING_DB_COLLECTION)
      .findOne({ key: SESSION_BOOKING_DB_KEY });

    const data = existing && existing.data
      ? existing.data
      : {};

    // Если уже отправляли сегодня — ничего не делаем
    if (data.lastSentDate === dateKey) {
      return;
    }

    const chatId = data.lastGroupChatId;

    // Если бот ещё не знает ни одного группового чата
    if (!chatId) {
      console.log(
        'Бронирование: групповой чат ещё не сохранён.'
      );
      return;
    }

    await bot.telegram.sendMessage(
      chatId,
      SESSION_BOOKING_TEXT,
      {
        parse_mode: 'HTML'
      }
    );

    // Запоминаем дату отправки
    await db
      .collection(SESSION_BOOKING_DB_COLLECTION)
      .updateOne(
        { key: SESSION_BOOKING_DB_KEY },
        {
          $set: {
            key: SESSION_BOOKING_DB_KEY,
            data: {
              ...data,
              lastGroupChatId: chatId,
              lastSentDate: dateKey,
              updatedAt: new Date().toISOString()
            },
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

    console.log(
      `Бронирование сессий отправлено в чат ${chatId}`
    );

  } catch (error) {
    console.error(
      'Ошибка автоматического бронирования:',
      error.message
    );
  }
}


// ------------------------------------------------------------
// Запоминаем последний групповой чат на любом сообщении
// ------------------------------------------------------------

bot.use(async (ctx, next) => {
  try {
    await rememberLastGroupForSessions(ctx);
  } catch (error) {
    console.error(
      'Ошибка rememberLastGroupForSessions:',
      error.message
    );
  }

  return next();
});


// ------------------------------------------------------------
// Проверка времени каждую минуту
// ------------------------------------------------------------

setInterval(async () => {
  await checkSessionBookingNotification();
}, 60 * 1000);


// ------------------------------------------------------------
// Дополнительная проверка сразу после запуска бота
// ------------------------------------------------------------

setTimeout(async () => {
  await checkSessionBookingNotification();
}, 5000);


// ============================================================
// КОНЕЦ БЛОКА БРОНИРОВАНИЯ СЕССИЙ
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
// К 500
// К 30.09.2026 500
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
  /^(?:(?:гл|г|болт|б|п\+|а|т|л|к)\s+\d{2}[./]\d{2}[./]\d{4}\s+\d+(?:[.,]\d+)?(?:\r?\n|$))+$/i,
  async ctx => {
    const lines = String(ctx.message.text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const parsed = [];
    const errors = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(гл|г|болт|б|п\+|а|т|л|к)\s+(\d{2}[./]\d{2}[./]\d{4})\s+(\d+(?:[.,]\d+)?)$/i);
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
      if (row.type === "personal" || row.type === "quests") {
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
// К 500
// К 30.09.2026 500
// ============================================================

bot.hears(
  /^к\s+(\d+(?:[.,]\d+)?)(?:\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2}))?$/i,
  async ctx => {
    await finalEarningsAddExtra(
      ctx,
      "quests",
      finalEarningsAmount(ctx.match[1]),
      ctx.match[2] || finalEarningsToday()
    );
  }
);

// Старый формат: К 30.09.2026 500
bot.hears(
  /^к\s+(\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2})\s+(\d+(?:[.,]\d+)?)$/i,
  async ctx => {
    await finalEarningsAddExtra(
      ctx,
      "quests",
      finalEarningsAmount(ctx.match[2]),
      ctx.match[1]
    );
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

    tea,

    quests:
      0,

    total:
      glovo +
      bolt +
      ipost +
      bolttr +
      personal +
      tea
  };
}


// ============================================================
// 🏍 УЧЁТ КИЛОМЕТРАЖА
// ============================================================

const MILEAGE_COLLECTION = "courier-mileage-v1";
const MILEAGE_KEY = "main";

async function mileageLoad() {
  const collection = db.collection(MILEAGE_COLLECTION);
  const doc = await collection.findOne({ key: MILEAGE_KEY });
  if (doc && doc.data) {
    if (!doc.data.users) doc.data.users = {};
    return doc.data;
  }
  const state = { users: {} };
  await collection.updateOne(
    { key: MILEAGE_KEY },
    { $set: { key: MILEAGE_KEY, data: state, updatedAt: Date.now() } },
    { upsert: true }
  );
  return state;
}

async function mileageSave(state) {
  await db.collection(MILEAGE_COLLECTION).updateOne(
    { key: MILEAGE_KEY },
    { $set: { key: MILEAGE_KEY, data: state, updatedAt: Date.now() } },
    { upsert: true }
  );
}

function mileageDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

function mileageRound(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function mileageDistance(readings) {
  if (!Array.isArray(readings) || readings.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < readings.length; i++) {
    const delta = Number(readings[i]) - Number(readings[i - 1]);
    if (Number.isFinite(delta) && delta >= 0) total += delta;
  }
  return mileageRound(total);
}

function mileageFormat(value) {
  return String(mileageRound(value));
}

async function mileageForDate(userId, dateKey) {
  const state = await mileageLoad();
  const user = state.users[String(userId)];
  const day = user && user.days && user.days[dateKey];
  return day ? mileageDistance(day.readings || []) : 0;
}

async function mileageForPeriod(userId, period) {
  const state = await mileageLoad();
  const user = state.users[String(userId)];
  if (!user || !user.days) return 0;
  const now = getNowKyiv();
  const periodKey = period === "week" ? getWeekKey(now) : getDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  let total = 0;
  for (const [dateKey, day] of Object.entries(user.days)) {
    const date = new Date(dateKey + "T12:00:00");
    if (Number.isNaN(date.getTime())) continue;
    const key = period === "week" ? getWeekKey(date) : getDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
    if (key === periodKey) total += mileageDistance(day.readings || []);
  }
  return mileageRound(total);
}

async function mileageAllForDate(dateKey) {
  const state = await mileageLoad();
  const result = {};
  for (const [id, user] of Object.entries(state.users || {})) {
    const day = user.days && user.days[dateKey];
    if (day) result[String(id)] = mileageDistance(day.readings || []);
  }
  return result;
}

async function mileageAllForPeriod(period) {
  const state = await mileageLoad();
  const now = getNowKyiv();
  const periodKey = period === "week" ? getWeekKey(now) : getDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const result = {};
  for (const [id, user] of Object.entries(state.users || {})) {
    let total = 0;
    for (const [dateKey, day] of Object.entries(user.days || {})) {
      const date = new Date(dateKey + "T12:00:00");
      if (Number.isNaN(date.getTime())) continue;
      const key = period === "week" ? getWeekKey(date) : getDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
      if (key === periodKey) total += mileageDistance(day.readings || []);
    }
    result[String(id)] = mileageRound(total);
  }
  return result;
}

const mileageCancelPending = new Map();

bot.hears(/^км\s+отмена$/i, async ctx => {
  try {
    const id = String(ctx.from.id);
    const today = mileageDateKey();
    const state = await mileageLoad();
    const user = state.users[id];
    const day = user && user.days && user.days[today];
    if (!day || !Array.isArray(day.readings) || day.readings.length === 0) {
      await ctx.reply("ℹ️ За сегодня нет показаний пробега, которые можно отменить.");
      return;
    }

    const readings = day.readings;
    let baselineCount = 0;
    const priorDates = Object.keys(user.days).filter(k => k < today).sort();
    if (priorDates.length) {
      const priorDay = user.days[priorDates[priorDates.length - 1]];
      const priorReadings = priorDay && priorDay.readings;
      if (Array.isArray(priorReadings) && priorReadings.length &&
          Number(readings[0]) === Number(priorReadings[priorReadings.length - 1])) {
        baselineCount = 1;
      }
    }
    if (readings.length <= baselineCount) {
      await ctx.reply("ℹ️ Сегодня ещё нет введённых показаний для отмены. Начальное показание с прошлого дня не удаляется.");
      return;
    }

    const token = `${id}:${today}:${Date.now()}`;
    mileageCancelPending.set(token, {
      userId: id,
      dateKey: today,
      lastReading: Number(readings[readings.length - 1]),
      readingCount: readings.length
    });
    await ctx.reply(
      "⚠️ Отменить последнее показание одометра " +
      mileageFormat(readings[readings.length - 1]) + " км за " + today + "?",
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Да, отменить", callback_data: "kmcancel_yes:" + token },
            { text: "❌ Нет", callback_data: "kmcancel_no:" + token }
          ]]
        }
      }
    );
  } catch (error) {
    console.error("MILEAGE CANCEL PREPARE ERROR:", error);
    await ctx.reply("❌ Не удалось подготовить отмену показания.");
  }
});

bot.action(/^kmcancel_(yes|no):(.+)$/i, async ctx => {
  try {
    const action = ctx.match[1].toLowerCase();
    const token = ctx.match[2];
    const pending = mileageCancelPending.get(token);
    if (!pending || String(ctx.from.id) !== pending.userId) {
      await ctx.answerCbQuery("Запрос отмены устарел. Отправь «км отмена» заново.", { show_alert: true });
      return;
    }
    mileageCancelPending.delete(token);
    await ctx.answerCbQuery();

    if (action === "no") {
      try { await ctx.editMessageText("Отмена показания не выполнена."); } catch {}
      return;
    }

    const state = await mileageLoad();
    const user = state.users[pending.userId];
    const day = user && user.days && user.days[pending.dateKey];
    if (!day || !Array.isArray(day.readings) ||
        day.readings.length !== pending.readingCount ||
        Number(day.readings[day.readings.length - 1]) !== pending.lastReading ||
        mileageDateKey() !== pending.dateKey) {
      try { await ctx.editMessageText("⚠️ Показания изменились или наступил новый день. Ничего не удалено — отправь «км отмена» заново."); } catch {}
      return;
    }

    let baselineCount = 0;
    const priorDates = Object.keys(user.days).filter(k => k < pending.dateKey).sort();
    if (priorDates.length) {
      const priorDay = user.days[priorDates[priorDates.length - 1]];
      const priorReadings = priorDay && priorDay.readings;
      if (Array.isArray(priorReadings) && priorReadings.length &&
          Number(day.readings[0]) === Number(priorReadings[priorReadings.length - 1])) {
        baselineCount = 1;
      }
    }
    if (day.readings.length <= baselineCount) {
      try { await ctx.editMessageText("Начальное показание прошлого дня защищено и не удаляется."); } catch {}
      return;
    }

    const removed = day.readings.pop();
    if (day.readings.length === 0) {
      delete user.days[pending.dateKey];
    } else {
      day.updatedAt = Date.now();
    }
    await mileageSave(state);
    const distance = mileageDistance(day.readings || []);
    const resultText =
      "↩️ Показание отменено: " + mileageFormat(removed) + " км\n" +
      "Осталось показаний: " + ((day.readings || []).length - baselineCount) + "\n" +
      "Пробег за день после отмены: " + mileageFormat(distance) + " км";
    try { await ctx.editMessageText(resultText); } catch { await ctx.reply(resultText); }
  } catch (error) {
    console.error("MILEAGE CANCEL CONFIRM ERROR:", error);
    try { await ctx.answerCbQuery("Не удалось отменить показание.", { show_alert: true }); } catch {}
  }
});

bot.hears(/^км(?:\s+(\d+(?:[.,]\d+)?))?$/i, async ctx => {
  try {
    const raw = ctx.match && ctx.match[1];
    if (!raw) {
      await ctx.reply("🏍 Чтобы записать одометр, отправь: км 17000\nКаждая следующая запись фиксирует новое показание. Пробег считается по разнице показаний.");
      return;
    }
    const odometer = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(odometer) || odometer < 0) {
      await ctx.reply("❌ Укажи корректное показание одометра, например: км 17000");
      return;
    }
    const state = await mileageLoad();
    const id = String(ctx.from.id);
    const today = mileageDateKey();
    const name = getTelegramDisplayName(ctx);
    if (!state.users[id]) state.users[id] = { name, days: {} };
    const user = state.users[id];
    user.name = name || user.name || "Курьер";
    if (!user.days) user.days = {};
    if (!user.days[today]) {
      let previous = null;
      const priorDates = Object.keys(user.days).filter(k => k < today).sort();
      if (priorDates.length) {
        const priorDay = user.days[priorDates[priorDates.length - 1]];
        const readings = priorDay && priorDay.readings;
        if (Array.isArray(readings) && readings.length) previous = Number(readings[readings.length - 1]);
      }
      user.days[today] = { readings: previous !== null && Number.isFinite(previous) ? [previous] : [], createdAt: Date.now() };
    }
    const day = user.days[today];
    const readings = day.readings || (day.readings = []);
    if (readings.length && odometer < Number(readings[readings.length - 1])) {
      await ctx.reply("❌ Новое показание меньше предыдущего (" + mileageFormat(readings[readings.length - 1]) + " км). Проверь число. Если одометр сбрасывался, напиши администратору.");
      return;
    }
    readings.push(mileageRound(odometer));
    day.updatedAt = Date.now();
    await mileageSave(state);
    const distance = mileageDistance(readings);
    const priorDatesForDisplay = Object.keys(user.days).filter(k => k < today).sort();
    let hasBaseline = false;
    if (priorDatesForDisplay.length) {
      const previousDay = user.days[priorDatesForDisplay[priorDatesForDisplay.length - 1]];
      const previousReadings = previousDay && previousDay.readings;
      hasBaseline = Array.isArray(previousReadings) && previousReadings.length > 0 &&
        readings.length > 0 &&
        Number(readings[0]) === Number(previousReadings[previousReadings.length - 1]);
    }
    const enteredCount = readings.length - (hasBaseline ? 1 : 0);
    let answer = "🏍 Показание одометра записано: " + mileageFormat(odometer) + " км\n";
    if (enteredCount >= 3) {
      answer += "\n";
      for (let i = 1; i < readings.length; i++) {
        answer += "Акум " + i + " — " + mileageFormat(Math.max(0, Number(readings[i]) - Number(readings[i - 1]))) + " км\n";
      }
    }
    answer += "\nОбщий пробег за день: " + mileageFormat(distance) + " км";
    await ctx.reply(answer);
  } catch (error) {
    console.error("MILEAGE INPUT ERROR:", error);
    await ctx.reply("❌ Не удалось сохранить километраж.");
  }
});


// ============================================================
// 💰 МОЙ ДЕНЬ
// ============================================================

bot.hears(
  /^мой день$/i,
  async ctx => {

    try {

      const report =
        await finalEarningsReport(
          String(
            ctx.from.id
          ),
          finalEarningsToday()
        );

      await ctx.reply(

        "💰 МОЙ ДЕНЬ\n" +
        "━━━━━━━━━━━━━━\n\n" +

        `🟡 Glovo — ${report.glovo} грн\n` +

        `🟢 Bolt — ${report.bolt} грн\n` +

        `🔴 iPOST — ${report.ipost} грн\n` +

        `🚨 Bolt TR — ${report.bolttr} грн\n` +

        `👤 Личные доставки — ${report.personal} грн\n` +

        `☕ Чаевые — ${report.tea} грн\n\n` +

        "━━━━━━━━━━━━━━\n" +

        `💰 ИТОГО — ${report.total} грн\n` +
        `🏍 Пробег за день — ${await mileageForDate(ctx.from.id, finalEarningsToday())} км`
      );

    } catch (error) {

      console.error(
        "MY DAY ERROR:",
        error
      );

      await ctx.reply(
        "❌ Ошибка формирования моего дня."
      );
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
        const mileage = await mileageForDate(item.userId, dateKey);
        text +=
          `${index + 1}. ${item.name}\n` +
          `🟡 ${item.glovo} | ` +
          `🟢 ${item.bolt} | ` +
          `🔴 ${item.ipost} | ` +
          `🚨 ${item.bolttr} | ` +
          `👤 ${item.personal} | ` +
          `☕ ${item.tea}\n` +
          `💰 Итого: ${item.total} грн\n` +
          `🏍 Пробег: ${mileage} км\n\n`;
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
        `☕ Чаевые — ${mine.tea} грн\n\n`;

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

      text +=
        `🏍 Пробег за период — ${await mileageForPeriod(userId, period)} км\n`;

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

          text +=
            `🏍 Пробег за период — ${await mileageForPeriod(item.userId, period)} км\n`;

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
      `🎯 Квесты — ${mine.quests} грн\n\n` +
      `💰 ИТОГО — ${mine.total} грн`;

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
          `☕ ${item.tea}\n` +
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


      // ЧАЕВЫЕ НЕ ТРОГАЕМ.


      await finalEarningsSave(
        state
      );


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

        "🎯 Квесты: 0 грн\n\n" +

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

bot.on("text", async ctx => {
  try {
    const text = ctx.message.text?.trim().toLowerCase();

    if (!text) return;

    const stickers = MEME_STICKERS[text];

    if (!stickers || stickers.length === 0) return;

    // Случайный стикер
    const randomSticker =
      stickers[Math.floor(Math.random() * stickers.length)];

    await ctx.replyWithSticker(randomSticker);

  } catch (err) {
    console.error("Ошибка отправки мем-стикера:", err);
  }
});
