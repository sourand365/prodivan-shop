// ============================================================
// TELEGRAM SHOP FOR NXCREATE — REBUILT VERSION
// Globals: bot, db
// Collection: shopdata
// ============================================================

const SHOP_ADMINS = ["5340322240", "688000422"];
const SHOP_COLLECTION = "shopdata";

// ============================================================
// DATABASE
// ============================================================

async function shopLoad() {
  const collection = db.collection(SHOP_COLLECTION);
  let record = await collection.findOne({ key: "main" });

  if (!record) {
    record = {
      key: "main",
      data: {
        categories: [],
        subcategories: [],
        products: [],
        orders: [],
        users: [],
        groups: [],
        carts: {},
        steps: {},
        broadcastMode: {},
        cash: { balances: {}, history: [] },
        counters: {
          category: 1,
          subcategory: 1,
          product: 1,
          order: 1
        }
      }
    };
    await collection.insertOne(record);
  }

  const d = record.data || {};

  ["categories", "subcategories", "products", "orders",
    "users", "groups"].forEach(function (key) {
      if (!Array.isArray(d[key])) d[key] = [];
    });

  ["carts", "steps", "broadcastMode"].forEach(function (key) {
    if (!d[key] || typeof d[key] !== "object" || Array.isArray(d[key])) {
      d[key] = {};
    }
  });

  if (!d.counters || typeof d.counters !== "object") d.counters = {};

  // Касса: миграция без потери существующих данных магазина.
  if (!d.cash || typeof d.cash !== "object" || Array.isArray(d.cash)) d.cash = {};
  if (!d.cash.balances || typeof d.cash.balances !== "object" || Array.isArray(d.cash.balances)) d.cash.balances = {};
  if (!Array.isArray(d.cash.history)) d.cash.history = [];
  SHOP_ADMINS.forEach(function (adminId) {
    if (!Number.isFinite(Number(d.cash.balances[adminId]))) d.cash.balances[adminId] = 0;
  });

  ["category", "subcategory", "product", "order"].forEach(function (key) {
    if (!Number(d.counters[key])) d.counters[key] = 1;
  });

  // Миграция старых товаров и заказов
  d.products.forEach(function (p) {
    p.stock = Math.max(0, Math.floor(Number(p.stock) || 0));
    p.reserved = Math.max(0, Math.floor(Number(p.reserved) || 0));

    if (!["available", "out", "transit"].includes(p.status)) {
      p.status = p.stock - p.reserved > 0 ? "available" : "out";
    }
  });

  d.orders.forEach(function (o) {
    if (!o.status) o.status = "new";
    if (!Array.isArray(o.items)) o.items = [];
    if (o.reserved === undefined) o.reserved = false;
  });

  return d;
}

async function shopSave(data) {
  await db.collection(SHOP_COLLECTION).updateOne(
    { key: "main" },
    { $set: { data: data } },
    { upsert: true }
  );
}

function shopId(prefix, number) {
  return prefix + String(number);
}

function shopIsAdmin(ctx) {
  return !!ctx.from && SHOP_ADMINS.includes(String(ctx.from.id));
}

async function shopAdminOnly(ctx) {
  if (shopIsAdmin(ctx)) return true;
  await ctx.reply("⛔ Эта функция доступна только администраторам магазина.");
  return false;
}

function shopPrivateChat(ctx) {
  return !!ctx.chat && ctx.chat.type === "private";
}

function shopKeyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

function shopButton(text, callback_data) {
  return { text: text, callback_data: callback_data };
}

function shopUrlButton(text, url) {
  return { text: text, url: url };
}

function shopMoney(value) {
  return Number(value || 0).toFixed(2) + " грн";
}

function shopUserName(ctx) {
  return (
    ((ctx.from.first_name || "") + " " + (ctx.from.last_name || "")).trim()
  ) || "Покупатель";
}

function shopStatusText(status) {
  if (status === "available") return "🟢 В наличии";
  if (status === "out") return "🔴 Закончился";
  if (status === "transit") return "🚚 В дороге";
  return "Не указан";
}

function shopOrderStatusText(status) {
  if (status === "new") return "⏳ Ожидает обработки";
  if (status === "in_progress") return "🛠 В работе";
  if (status === "confirmed") return "✅ Продажа подтверждена";
  if (status === "cancelled") return "❌ Отменён";
  return String(status || "Неизвестен");
}

function shopFindProduct(data, id) {
  return data.products.find(function (p) {
    return String(p.id) === String(id);
  });
}

function shopFindCategory(data, id) {
  return data.categories.find(function (c) {
    return String(c.id) === String(id);
  });
}

function shopFindSubcategory(data, id) {
  return data.subcategories.find(function (s) {
    return String(s.id) === String(id);
  });
}

function shopFindOrder(data, id) {
  return data.orders.find(function (o) {
    return String(o.id) === String(id);
  });
}

function shopFreeStock(product) {
  return Math.max(
    0,
    Number(product.stock || 0) - Number(product.reserved || 0)
  );
}

// Приоритет каталога: наличие, дорога, закончившиеся
function shopProductSort(a, b) {
  const priority = { available: 0, transit: 1, out: 2 };
  return (priority[a.status] ?? 3) - (priority[b.status] ?? 3);
}

function shopSyncProductStatus(product) {
  if (product.status === "transit") return;

  product.status = shopFreeStock(product) > 0 ? "available" : "out";
}

function shopSyncAllProducts(data) {
  data.products.forEach(shopSyncProductStatus);
}

function shopOrderDetails(order) {
  const lines = [
    "🛒 ЗАКАЗ №" + order.id,
    "",
    "Статус: " + shopOrderStatusText(order.status),
    "Взял в работу: " + (order.takenByName || "—"),
    "",
    "Имя: " + (order.customerName || "—"),
    "Telegram: " + (order.username ? "@" + order.username : "username отсутствует"),
    "Telegram ID: " + order.userId,
    "Телефон: " + (order.phone || "—"),
    "Адрес: " + (order.address || "—"),
    "",
    "Товары:"
  ];

  (order.items || []).forEach(function (item) {
    lines.push(
      "• " + item.name + " × " + item.qty +
      " — " + shopMoney(Number(item.price) * Number(item.qty))
    );
  });

  lines.push("");
  lines.push("Итого: " + shopMoney(order.total));
  lines.push("Создан: " + new Date(order.createdAt).toLocaleString("ru-RU"));

  return lines.join("\n");
}

// ============================================================
// USER REGISTRATION
// ============================================================

async function shopRegisterUser(ctx) {
  if (!ctx.from) return;

  const data = await shopLoad();
  const id = String(ctx.from.id);
  let user = data.users.find(function (u) {
    return String(u.id) === id;
  });

  const fields = {
    id: id,
    name: shopUserName(ctx),
    username: ctx.from.username || "",
    updatedAt: Date.now()
  };

  if (user) Object.assign(user, fields);
  else data.users.push(fields);

  await shopSave(data);
}

// ============================================================
// MAIN MENU AND CATALOG
// ============================================================

async function shopMainMenu(ctx) {
  const rows = [
    [shopButton("🛍 Открыть каталог", "shop_catalog")],
    [
      shopButton("🛒 Корзина", "shop_cart"),
      shopButton("📦 Мои заказы", "shop_myorders")
    ]
  ];

  if (shopIsAdmin(ctx)) {
    rows.push([shopButton("⚙️ Панель управления", "shop_admin")]);
  }

  await ctx.reply(
    "Добро пожаловать в магазин!\n\nВыберите нужный раздел:",
    shopKeyboard(rows)
  );
}

async function shopShowCategories(ctx) {
  const data = await shopLoad();
  const rows = data.categories.map(function (c) {
    return [shopButton("📁 " + c.name, "shop_cat_" + c.id)];
  });

  rows.push([shopButton("🛒 Корзина", "shop_cart")]);
  rows.push([shopButton("⬅️ Главное меню", "shop_home")]);

  await ctx.reply(
    data.categories.length ? "🛍 Каталог товаров:" : "Каталог пока пуст.",
    shopKeyboard(rows)
  );
}

async function shopShowCategory(ctx, categoryId) {
  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория не найдена.");
    return;
  }

  const rows = [];

  data.subcategories
    .filter(function (s) {
      return String(s.categoryId) === String(categoryId);
    })
    .forEach(function (s) {
      rows.push([shopButton("📂 " + s.name, "shop_sub_" + s.id)]);
    });

  data.products
    .filter(function (p) {
      return String(p.categoryId) === String(categoryId) && !p.subcategoryId;
    })
    .slice()
    .sort(shopProductSort)
    .forEach(function (p) {
      rows.push([
        shopButton(
          (p.status === "available" ? "🟢 " :
            p.status === "transit" ? "🚚 " : "🔴 ") +
          p.name + " — " + shopMoney(p.price),
          "shop_product_" + p.id
        )
      ]);
    });

  rows.push([shopButton("⬅️ Все категории", "shop_catalog")]);
  rows.push([shopButton("🛒 Корзина", "shop_cart")]);

  await ctx.reply("📁 Категория: " + category.name, shopKeyboard(rows));
}

async function shopShowSubcategory(ctx, subcategoryId) {
  const data = await shopLoad();
  const sub = shopFindSubcategory(data, subcategoryId);

  if (!sub) {
    await ctx.reply("Подкатегория не найдена.");
    return;
  }

  const products = data.products
    .filter(function (p) {
      return String(p.subcategoryId) === String(subcategoryId);
    })
    .slice()
    .sort(shopProductSort);

  const rows = products.map(function (p) {
    return [
      shopButton(
        (p.status === "available" ? "🟢 " :
          p.status === "transit" ? "🚚 " : "🔴 ") +
        p.name + " — " + shopMoney(p.price),
        "shop_product_" + p.id
      )
    ];
  });

  rows.push([
    shopButton("⬅️ Назад к категории", "shop_cat_" + sub.categoryId)
  ]);

  await ctx.reply(
    products.length ? "📂 " + sub.name + "\nВыберите товар:" :
      "В этой подкатегории пока нет товаров.",
    shopKeyboard(rows)
  );
}

async function shopShowProduct(ctx, productId) {
  const data = await shopLoad();
  const product = shopFindProduct(data, productId);

  if (!product) {
    await ctx.reply("Товар не найден.");
    return;
  }

  const free = shopFreeStock(product);
  const text =
    "🛍 " + product.name + "\n\n" +
    (product.description || "Описание отсутствует.") + "\n\n" +
    "💰 Цена: " + shopMoney(product.price) + "\n" +
    "📌 Статус: " + shopStatusText(product.status) + "\n" +
    "📦 Доступно для заказа: " + free;

  const rows = [];

  if (product.status === "available" && free > 0) {
    rows.push([shopButton("➕ Добавить в корзину", "shop_add_" + product.id)]);
  }

  rows.push([shopButton("🛒 Открыть корзину", "shop_cart")]);
  rows.push([shopButton("⬅️ Каталог", "shop_catalog")]);

  if (product.photo) {
    try {
      await ctx.replyWithPhoto(product.photo, {
        caption: text,
        reply_markup: { inline_keyboard: rows }
      });
      return;
    } catch (e) {
      console.error("SHOP PHOTO ERROR:", e);
    }
  }

  await ctx.reply(text, shopKeyboard(rows));
}

// ============================================================
// CART
// ============================================================

async function shopAddToCart(ctx, productId) {
  const data = await shopLoad();
  const product = shopFindProduct(data, productId);
  const userId = String(ctx.from.id);

  if (!product) {
    await ctx.reply("Товар не найден.");
    return;
  }

  shopSyncProductStatus(product);

  if (product.status !== "available" || shopFreeStock(product) < 1) {
    await ctx.reply("Сейчас этот товар недоступен для заказа.");
    return;
  }

  if (!data.carts[userId]) data.carts[userId] = [];
  const cart = data.carts[userId];

  let line = cart.find(function (x) {
    return String(x.productId) === String(productId);
  });

  const current = line ? Number(line.qty) : 0;

  if (current + 1 > shopFreeStock(product)) {
    await ctx.reply("Нельзя добавить больше доступного количества.");
    return;
  }

  if (line) line.qty = current + 1;
  else cart.push({ productId: String(product.id), qty: 1 });

  await shopSave(data);

  await ctx.reply(
    "✅ «" + product.name + "» добавлен в корзину.",
    shopKeyboard([
      [shopButton("🛒 Открыть корзину", "shop_cart")],
      [shopButton("⬅️ Продолжить покупки", "shop_catalog")]
    ])
  );
}

async function shopShowCart(ctx) {
  const data = await shopLoad();
  const cart = data.carts[String(ctx.from.id)] || [];

  if (!cart.length) {
    await ctx.reply(
      "🛒 Корзина пуста.",
      shopKeyboard([
        [shopButton("🛍 Открыть каталог", "shop_catalog")],
        [shopButton("⬅️ Главное меню", "shop_home")]
      ])
    );
    return;
  }

  const lines = ["🛒 Ваша корзина:\n"];
  const rows = [];
  let total = 0;

  cart.forEach(function (item) {
    const p = shopFindProduct(data, item.productId);
    if (!p) return;

    const qty = Number(item.qty);
    const sum = Number(p.price) * qty;
    total += sum;

    lines.push("• " + p.name + " × " + qty + "\n  " + shopMoney(sum));
    rows.push([shopButton("➖ Убрать 1: " + p.name, "shop_remove_" + p.id)]);
  });

  lines.push("\nИтого: " + shopMoney(total));

  rows.push([shopButton("✅ Оформить заказ", "shop_checkout")]);
  rows.push([shopButton("🗑 Очистить корзину", "shop_clearcart")]);
  rows.push([shopButton("⬅️ Каталог", "shop_catalog")]);

  await ctx.reply(lines.join("\n"), shopKeyboard(rows));
}

async function shopRemoveFromCart(ctx, productId) {
  const data = await shopLoad();
  const userId = String(ctx.from.id);
  const cart = data.carts[userId] || [];
  const index = cart.findIndex(function (x) {
    return String(x.productId) === String(productId);
  });

  if (index >= 0) {
    cart[index].qty = Number(cart[index].qty) - 1;
    if (cart[index].qty <= 0) cart.splice(index, 1);
  }

  data.carts[userId] = cart;
  await shopSave(data);
  await shopShowCart(ctx);
}

async function shopClearCart(ctx) {
  const data = await shopLoad();
  data.carts[String(ctx.from.id)] = [];
  await shopSave(data);

  await ctx.reply(
    "🗑 Корзина очищена.",
    shopKeyboard([
      [shopButton("🛍 Каталог", "shop_catalog")],
      [shopButton("⬅️ Главное меню", "shop_home")]
    ])
  );
}

// ============================================================
// CHECKOUT AND STOCK RESERVATION
// ============================================================

async function shopBeginCheckout(ctx) {
  const data = await shopLoad();
  const userId = String(ctx.from.id);

  if (!(data.carts[userId] || []).length) {
    await ctx.reply("Корзина пуста.");
    return;
  }

  delete data.broadcastMode[userId];
  data.steps[userId] = { step: "order_name" };
  await shopSave(data);

  await ctx.reply(
    "📝 Оформление заказа.\n\nВведите имя и фамилию.\n\n" +
    "Username Telegram будет сохранён автоматически, если он указан в профиле.",
    shopKeyboard([
      [shopButton("❌ Отменить оформление", "shop_cancel_input")]
    ])
  );
}

async function shopFinishCheckout(ctx, data, userId, stepData, address) {
  const cart = data.carts[userId] || [];

  if (!cart.length) {
    delete data.steps[userId];
    await shopSave(data);
    await ctx.reply("Корзина пуста. Заказ не создан.");
    return;
  }

  const items = [];
  let total = 0;

  // Сначала проверяем все позиции; резервируем только если проверка успешна.
  for (const line of cart) {
    const product = shopFindProduct(data, line.productId);
    const qty = Number(line.qty);

    if (!product || !Number.isInteger(qty) || qty < 1) {
      await ctx.reply("Одна из позиций корзины некорректна. Проверьте корзину.");
      return;
    }

    if (product.status === "transit" || shopFreeStock(product) < qty) {
      await ctx.reply(
        "Недостаточно свободного товара «" + product.name +
        "». Доступно: " + shopFreeStock(product) + ". Измените корзину."
      );
      return;
    }

    const price = Number(product.price);
    total += price * qty;

    items.push({
      productId: String(product.id),
      name: product.name,
      price: price,
      qty: qty
    });
  }

  // Создаём резерв по всем позициям.
  items.forEach(function (item) {
    const p = shopFindProduct(data, item.productId);
    p.reserved = Number(p.reserved || 0) + Number(item.qty);
    shopSyncProductStatus(p);
  });

  const order = {
    id: shopId("o", data.counters.order++),
    userId: String(userId),
    username: ctx.from.username || "",
    customerName: stepData.name || shopUserName(ctx),
    phone: stepData.phone || "",
    address: address,
    items: items,
    total: total,
    status: "new",
    reserved: true,
    createdAt: Date.now(),
    confirmedBy: null,
    takenBy: null,
    takenByName: null
  };

  data.orders.push(order);
  data.carts[userId] = [];
  delete data.steps[userId];

  await shopSave(data);

  await ctx.reply(
    "✅ Заказ №" + order.id + " создан!\n\n" +
    "Сумма: " + shopMoney(order.total) + "\n" +
    "Товары зарезервированы до подтверждения или отмены заказа.\n" +
    "Статус: ожидает обработки."
  );

  await shopNotifyAdmins(order);
}

async function shopNotifyAdmins(order) {
  const rows = [
    [shopButton("🛠 Взять в работу", "shop_take_" + order.id)],
    [shopButton("❌ Отменить заказ", "shop_cancel_" + order.id)],
    [shopButton("📄 Подробнее", "shop_admin_order_" + order.id)]
  ];

  for (const adminId of SHOP_ADMINS) {
    try {
      await bot.telegram.sendMessage(
        Number(adminId),
        shopOrderDetails(order),
        shopKeyboard(rows)
      );
    } catch (e) {
      console.error("SHOP ADMIN NOTIFY ERROR:", adminId, e);
    }
  }
}

// ============================================================
// MY ORDERS
// ============================================================

async function shopShowMyOrders(ctx) {
  const data = await shopLoad();
  const userId = String(ctx.from.id);

  const orders = data.orders
    .filter(function (o) {
      return String(o.userId) === userId;
    })
    .sort(function (a, b) {
      return Number(b.createdAt) - Number(a.createdAt);
    })
    .slice(0, 10);

  if (!orders.length) {
    await ctx.reply(
      "У вас пока нет заказов.",
      shopKeyboard([
        [shopButton("🛍 Каталог", "shop_catalog")],
        [shopButton("⬅️ Главное меню", "shop_home")]
      ])
    );
    return;
  }

  const rows = orders.map(function (o) {
    return [
      shopButton(
        "№" + o.id + " — " + shopOrderStatusText(o.status),
        "shop_orderinfo_" + o.id
      )
    ];
  });

  rows.push([shopButton("⬅️ Главное меню", "shop_home")]);
  await ctx.reply("📦 Ваши последние заказы:", shopKeyboard(rows));
}

async function shopShowOrderInfo(ctx, orderId) {
  const data = await shopLoad();
  const order = data.orders.find(function (o) {
    return String(o.id) === String(orderId) &&
      String(o.userId) === String(ctx.from.id);
  });

  if (!order) {
    await ctx.reply("Заказ не найден.");
    return;
  }

  await ctx.reply(
    shopOrderDetails(order),
    shopKeyboard([
      [shopButton("⬅️ Мои заказы", "shop_myorders")],
      [shopButton("⬅️ Главное меню", "shop_home")]
    ])
  );
}

// ============================================================
// CASH REGISTER — separate balances, shared withdrawal permissions
// ============================================================

function shopCashAdminLabel(adminId) {
  const id = String(adminId);
  return id === SHOP_ADMINS[0] ? "Администратор №1" :
    id === SHOP_ADMINS[1] ? "Администратор №2" : "Администратор " + id;
}

async function shopCashMenu(ctx) {
  if (!(await shopAdminOnly(ctx))) return;
  const data = await shopLoad();
  const rows = [];
  SHOP_ADMINS.forEach(function (id) {
    rows.push([shopButton("💰 " + shopCashAdminLabel(id) + " — " + shopMoney(data.cash.balances[id]), "shop_cash_account_" + id)]);
  });
  rows.push([shopButton("📜 История кассы", "shop_cash_history")]);
  rows.push([shopButton("⬅️ Админ-панель", "shop_admin")]);
  await ctx.reply("💰 КАССА МАГАЗИНА\n\nВыберите кассу для просмотра или снятия денег. Оба администратора могут управлять обеими кассами.", shopKeyboard(rows));
}

async function shopCashAccount(ctx, adminId) {
  if (!(await shopAdminOnly(ctx))) return;
  if (!SHOP_ADMINS.includes(String(adminId))) { await ctx.reply("Касса не найдена."); return; }
  const data = await shopLoad();
  const balance = Number(data.cash.balances[adminId] || 0);
  const rows = [[shopButton("💸 Снять деньги", "shop_cash_withdraw_" + adminId)],
    [shopButton("📜 История этой кассы", "shop_cash_history_" + adminId)],
    [shopButton("⬅️ Все кассы", "shop_cash")]];
  await ctx.reply("💰 " + shopCashAdminLabel(adminId) + "\n\nДоступный баланс: " + shopMoney(balance), shopKeyboard(rows));
}

async function shopCashHistory(ctx, adminId) {
  if (!(await shopAdminOnly(ctx))) return;
  const data = await shopLoad();
  let history = data.cash.history.slice().reverse();
  if (adminId) history = history.filter(function (entry) { return String(entry.accountId) === String(adminId); });
  history = history.slice(0, 30);
  if (!history.length) { await ctx.reply("📜 История кассы пока пуста.", shopKeyboard([[shopButton("⬅️ К кассе", "shop_cash")]])); return; }
  const lines = history.map(function (entry) {
    const date = new Date(entry.at || Date.now()).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" });
    const sign = Number(entry.amount) >= 0 ? "+" : "−";
    return "• " + date + "\n  " + (entry.type === "sale" ? "✅ Закрытие заказа №" + entry.orderId : "💸 Снятие денег") + "\n  Касса: " + shopCashAdminLabel(entry.accountId) + "\n  Сумма: " + sign + shopMoney(Math.abs(Number(entry.amount))) + "\n  Выполнил: " + (entry.actorName || entry.actorId || "—");
  });
  await ctx.reply("📜 ИСТОРИЯ КАССЫ\n\n" + lines.join("\n\n"), shopKeyboard([[shopButton("⬅️ К кассе", "shop_cash")]]));
}

async function shopCashBeginWithdraw(ctx, adminId) {
  if (!(await shopAdminOnly(ctx))) return;
  if (!SHOP_ADMINS.includes(String(adminId))) { await ctx.reply("Касса не найдена."); return; }
  const data = await shopLoad();
  const balance = Number(data.cash.balances[adminId] || 0);
  if (balance <= 0) { await ctx.reply("В этой кассе нет денег для снятия.", shopKeyboard([[shopButton("⬅️ Назад", "shop_cash_account_" + adminId)]])); return; }
  data.steps[String(ctx.from.id)] = { step: "cash_withdraw_amount", accountId: String(adminId) };
  await shopSave(data);
  await ctx.reply("💸 Снятие с кассы «" + shopCashAdminLabel(adminId) + "».\nДоступно: " + shopMoney(balance) + "\n\nВведите сумму для снятия цифрами (например: 250 или 250.50). Для отмены отправьте /cancel.");
}

async function shopCashFinishWithdraw(ctx, data, uid, step, rawAmount) {
  const accountId = String(step.accountId);
  const amount = Math.round(Number(rawAmount.replace(",", ".")) * 100) / 100;
  const balance = Number(data.cash.balances[accountId] || 0);
  if (!Number.isFinite(amount) || amount <= 0) { await ctx.reply("Введите корректную сумму больше нуля, например 250 или 250.50."); return; }
  if (amount > balance + 0.000001) { await ctx.reply("Недостаточно денег в кассе. Доступно: " + shopMoney(balance) + ". Введите меньшую сумму или /cancel."); return; }
  data.cash.balances[accountId] = Math.round((balance - amount) * 100) / 100;
  data.cash.history.push({ id: "cash_" + Date.now() + "_" + uid, type: "withdrawal", accountId: accountId, amount: -amount, actorId: uid, actorName: shopUserName(ctx), at: Date.now() });
  delete data.steps[uid];
  await shopSave(data);
  await ctx.reply("✅ Снятие записано в историю.\nКасса: " + shopCashAdminLabel(accountId) + "\nСнято: " + shopMoney(amount) + "\nОстаток: " + shopMoney(data.cash.balances[accountId]), shopKeyboard([[shopButton("💰 Касса", "shop_cash")], [shopButton("📜 История", "shop_cash_history")]]));
}

// ============================================================
// ORDER WORKFLOW: NEW -> IN_PROGRESS -> CONFIRMED
// CANCELLATION RELEASES RESERVED STOCK
// ============================================================

async function shopTakeOrder(ctx, orderId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const order = shopFindOrder(data, orderId);

  if (!order) {
    await ctx.reply("Заказ не найден.");
    return;
  }

  if (order.status !== "new") {
    await ctx.reply(
      "Заказ нельзя взять в работу. Текущий статус: " +
      shopOrderStatusText(order.status)
    );
    return;
  }

  order.status = "in_progress";
  order.takenBy = String(ctx.from.id);
  order.takenByName = shopUserName(ctx);
  order.takenAt = Date.now();

  await shopSave(data);

  await ctx.reply("🛠 Заказ №" + order.id + " взят в работу.");
  await shopRenderAdminOrder(ctx, order);
}

async function shopConfirmOrder(ctx, orderId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const order = shopFindOrder(data, orderId);

  if (!order) {
    await ctx.reply("Заказ не найден.");
    return;
  }

  if (order.status !== "in_progress") {
    await ctx.reply("Сначала возьмите заказ в работу. Текущий статус: " +
      shopOrderStatusText(order.status));
    return;
  }

  if (
    order.takenBy &&
    String(order.takenBy) !== String(ctx.from.id)
  ) {
    await ctx.reply("Этот заказ уже взят в работу другим администратором.");
    return;
  }

  // Проверяем все позиции перед изменением остатков.
  for (const item of order.items) {
    const p = shopFindProduct(data, item.productId);

    if (!p || Number(p.reserved || 0) < Number(item.qty) ||
      Number(p.stock || 0) < Number(item.qty)) {
      await ctx.reply(
        "❌ Не удалось подтвердить продажу: резерв или склад некорректен " +
        "для товара «" + item.name + "». Остатки не изменены."
      );
      return;
    }
  }

  // Списание выполняется ровно один раз — только из in_progress.
  order.items.forEach(function (item) {
    const p = shopFindProduct(data, item.productId);
    p.stock = Number(p.stock) - Number(item.qty);
    p.reserved = Math.max(0, Number(p.reserved || 0) - Number(item.qty));
    shopSyncProductStatus(p);
  });

  order.reserved = false;
  order.status = "confirmed";
  order.confirmedBy = String(ctx.from.id);
  order.confirmedByName = shopUserName(ctx);
  order.confirmedAt = Date.now();

  // Начисляем полную сумму заказа на кассу администратора, закрывшего заказ.
  // Статус in_progress защищает от повторного начисления при повторном нажатии.
  const cashAdminId = String(ctx.from.id);
  if (!order.cashCreditedAt) {
    if (!data.cash || !data.cash.balances) data.cash = { balances: {}, history: [] };
    if (!Array.isArray(data.cash.history)) data.cash.history = [];
    if (!Number.isFinite(Number(data.cash.balances[cashAdminId]))) data.cash.balances[cashAdminId] = 0;
    const creditedAmount = Math.round(Number(order.total || 0) * 100) / 100;
    data.cash.balances[cashAdminId] = Math.round((Number(data.cash.balances[cashAdminId]) + creditedAmount) * 100) / 100;
    order.cashCreditedAt = Date.now();
    order.cashCreditedTo = cashAdminId;
    data.cash.history.push({ id: "sale_" + order.id, type: "sale", orderId: String(order.id), accountId: cashAdminId, amount: creditedAmount, actorId: cashAdminId, actorName: shopUserName(ctx), at: Date.now() });
  }

  await shopSave(data);

  await ctx.reply("✅ Продажа по заказу №" + order.id + " подтверждена.");

  try {
    await bot.telegram.sendMessage(
      Number(order.userId),
      "✅ Продажа по заказу №" + order.id + " подтверждена!\n\n" +
      "Сумма: " + shopMoney(order.total)
    );
  } catch (e) {
    console.error("SHOP CUSTOMER CONFIRM ERROR:", e);
  }

  await shopRenderAdminOrder(ctx, order);
}

async function shopCancelOrder(ctx, orderId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const order = shopFindOrder(data, orderId);

  if (!order) {
    await ctx.reply("Заказ не найден.");
    return;
  }

  if (!["new", "in_progress"].includes(order.status)) {
    await ctx.reply(
      "Заказ уже обработан. Статус: " + shopOrderStatusText(order.status)
    );
    return;
  }

  // Возвращаем резерв в свободное количество, физический stock не меняется.
  if (order.reserved !== false) {
    order.items.forEach(function (item) {
      const p = shopFindProduct(data, item.productId);
      if (p) {
        p.reserved = Math.max(
          0,
          Number(p.reserved || 0) - Number(item.qty)
        );
        shopSyncProductStatus(p);
      }
    });
  }

  order.reserved = false;
  order.status = "cancelled";
  order.cancelledBy = String(ctx.from.id);
  order.cancelledByName = shopUserName(ctx);
  order.cancelledAt = Date.now();

  await shopSave(data);
  await ctx.reply("❌ Заказ №" + order.id + " отменён. Резерв освобождён.");

  try {
    await bot.telegram.sendMessage(
      Number(order.userId),
      "❌ Заказ №" + order.id + " отменён администратором. Резерв товара освобождён."
    );
  } catch (e) {
    console.error("SHOP CUSTOMER CANCEL ERROR:", e);
  }

  await shopRenderAdminOrder(ctx, order);
}

async function shopRenderAdminOrder(ctx, order) {
  const rows = [];

  if (order.status === "new") {
    rows.push([shopButton("🛠 Взять в работу", "shop_take_" + order.id)]);
    rows.push([shopButton("❌ Отменить заказ", "shop_cancel_" + order.id)]);
  }

  if (order.status === "in_progress") {
    if (order.username) {
      rows.push([
        shopUrlButton(
          "💬 Написать клиенту",
          "https://t.me/" + order.username.replace(/^@/, "")
        )
      ]);
    } else {
      rows.push([
        shopButton("⚠️ У клиента нет username", "shop_no_username_" + order.id)
      ]);
    }

    rows.push([shopButton("✅ Подтвердить продажу", "shop_confirm_" + order.id)]);
    rows.push([shopButton("❌ Отменить заказ", "shop_cancel_" + order.id)]);
  }

  rows.push([shopButton("⬅️ Все заказы", "shop_admin_orders")]);

  await ctx.reply(shopOrderDetails(order), shopKeyboard(rows));
}

// ============================================================// ADMIN MENU
// ============================================================

async function shopAdminMenu(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  await ctx.reply(
    "⚙️ ПАНЕЛЬ УПРАВЛЕНИЯ МАГАЗИНОМ\n\nВыберите действие:",
    shopKeyboard([
      [
        shopButton("📁 Категории", "shop_admin_categories"),
        shopButton("📂 Подкатегории", "shop_admin_subcategories")
      ],
      [
        shopButton("➕ Добавить товар", "shop_admin_addproduct"),
        shopButton("📦 Товары и склад", "shop_admin_products")
      ],
      [shopButton("🧾 Заказы", "shop_admin_orders")],
      [shopButton("💰 Касса", "shop_cash")],
      [shopButton("📣 Рассылка", "shop_broadcast_menu")],
      [shopButton("👥 Подключённые группы", "shop_admin_groups")],
      [shopButton("⬅️ Главное меню", "shop_home")]
    ])
  );
}

async function shopAdminCategories(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const rows = [[shopButton("➕ Добавить категорию", "shop_admin_addcategory")]];

  data.categories.forEach(function (c) {
    rows.push([shopButton("📁 " + c.name, "shop_admin_category_" + c.id)]);
  });

  rows.push([shopButton("⬅️ Админ-панель", "shop_admin")]);
  await ctx.reply("📁 УПРАВЛЕНИЕ КАТЕГОРИЯМИ", shopKeyboard(rows));
}

async function shopAdminSubcategories(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const rows = [[shopButton("➕ Добавить подкатегорию", "shop_admin_addsubcategory")]];

  data.categories.forEach(function (c) {
    rows.push([
      shopButton("📁 " + c.name, "shop_admin_subcat_category_" + c.id)
    ]);
  });

  rows.push([shopButton("⬅️ Админ-панель", "shop_admin")]);
  await ctx.reply("📂 ПОДКАТЕГОРИИ\n\nСначала выберите категорию:", shopKeyboard(rows));
}

async function shopAdminShowSubcategories(ctx, categoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория не найдена.");
    return;
  }

  const rows = data.subcategories
    .filter(function (s) {
      return String(s.categoryId) === String(categoryId);
    })
    .map(function (s) {
      return [shopButton("📂 " + s.name, "shop_admin_subcat_info_" + s.id)];
    });

  rows.push([
    shopButton("➕ Добавить в эту категорию",
      "shop_admin_addsubcategory_to_" + category.id)
  ]);
  rows.push([shopButton("⬅️ Категории", "shop_admin_subcategories")]);

  await ctx.reply("Категория: " + category.name, shopKeyboard(rows));
}

async function shopAdminSubcategoryInfo(ctx, subcategoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const sub = shopFindSubcategory(data, subcategoryId);

  if (!sub) {
    await ctx.reply("Подкатегория не найдена.");
    return;
  }

  const category = shopFindCategory(data, sub.categoryId);
  const productCount = data.products.filter(function (p) {
    return String(p.subcategoryId) === String(sub.id);
  }).length;

  await ctx.reply(
    "📂 Подкатегория: " + sub.name +
    "\nКатегория: " + (category ? category.name : "не найдена") +
    "\nТоваров: " + productCount,
    shopKeyboard([
      [shopButton("🗑 Удалить подкатегорию", "shop_delete_sub_" + sub.id)],
      [shopButton("⬅️ Назад", "shop_admin_subcat_category_" + sub.categoryId)]
    ])
  );
}

async function shopAdminCategoryInfo(ctx, categoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория не найдена.");
    return;
  }

  const subs = data.subcategories.filter(function (s) {
    return String(s.categoryId) === String(category.id);
  });

  const products = data.products.filter(function (p) {
    return String(p.categoryId) === String(category.id);
  });

  await ctx.reply(
    "📁 " + category.name + "\n\n" +
    "ID: " + category.id + "\n" +
    "Подкатегорий: " + subs.length + "\n" +
    "Товаров: " + products.length,
    shopKeyboard([
      [shopButton("➕ Подкатегория", "shop_admin_addsubcategory_to_" + category.id)],
      [shopButton("🗑 Удалить категорию", "shop_delete_cat_" + category.id)],
      [shopButton("⬅️ Категории", "shop_admin_categories")]
    ])
  );
}

// ============================================================
// CATEGORY / SUBCATEGORY DELETION
// ============================================================

async function shopDeleteCategoryConfirm(ctx, categoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория не найдена.");
    return;
  }

  const subs = data.subcategories.filter(function (s) {
    return String(s.categoryId) === String(category.id);
  });

  const products = data.products.filter(function (p) {
    return String(p.categoryId) === String(category.id);
  });

  await ctx.reply(
    "⚠️ Удалить категорию «" + category.name + "»?\n\n" +
    "Подкатегорий: " + subs.length + "\n" +
    "Товаров: " + products.length + "\n\n" +
    "Все её товары и подкатегории также будут удалены. " +
    "Заказы с сохранёнными копиями товаров останутся в истории.",
    shopKeyboard([
      [shopButton("⚠️ Да, удалить всё", "shop_delete_cat_yes_" + category.id)],
      [shopButton("❌ Не удалять", "shop_admin_category_" + category.id)]
    ])
  );
}

async function shopDeleteCategory(ctx, categoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория уже удалена.");
    return;
  }

  const subIds = data.subcategories
    .filter(function (s) {
      return String(s.categoryId) === String(category.id);
    })
    .map(function (s) {
      return String(s.id);
    });

  const categoryProductIds = data.products.filter(function (p) {
    return String(p.categoryId) === String(category.id) ||
      subIds.includes(String(p.subcategoryId));
  }).map(function (p) { return String(p.id); });

  const activeOrder = data.orders.find(function (order) {
    return ["new", "in_progress"].includes(String(order.status)) &&
      Array.isArray(order.items) && order.items.some(function (item) {
        return categoryProductIds.includes(String(item.productId));
      });
  });

  if (activeOrder) {
    await ctx.reply(
      "❌ Нельзя удалить категорию: товар из неё есть в активном заказе №" + activeOrder.id + ".\n\nСначала завершите или отмените этот заказ. История заказов сохранится.",
      shopKeyboard([[shopButton("⬅️ К категории", "shop_admin_category_" + category.id)], [shopButton("🧾 Все заказы", "shop_admin_orders")]])
    );
    return;
  }

  data.products = data.products.filter(function (p) {
    return String(p.categoryId) !== String(category.id);
  });

  data.subcategories = data.subcategories.filter(function (s) {
    return String(s.categoryId) !== String(category.id);
  });

  data.categories = data.categories.filter(function (c) {
    return String(c.id) !== String(category.id);
  });

  await shopSave(data);
  await ctx.reply("🗑 Категория и её товары/подкатегории удалены.",
    shopKeyboard([
      [shopButton("📁 Категории", "shop_admin_categories")],
      [shopButton("⚙️ Админ-панель", "shop_admin")]
    ]));
}

async function shopDeleteSubcategoryConfirm(ctx, subId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const sub = shopFindSubcategory(data, subId);

  if (!sub) {
    await ctx.reply("Подкатегория не найдена.");
    return;
  }

  const count = data.products.filter(function (p) {
    return String(p.subcategoryId) === String(sub.id);
  }).length;

  await ctx.reply(
    "Удалить подкатегорию «" + sub.name + "» и товары внутри неё?\n" +
    "Товаров: " + count,
    shopKeyboard([
      [shopButton("⚠️ Да, удалить", "shop_delete_sub_yes_" + sub.id)],
      [shopButton("❌ Отмена", "shop_admin_subcat_info_" + sub.id)]
    ])
  );
}

async function shopDeleteSubcategory(ctx, subId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const sub = shopFindSubcategory(data, subId);

  if (!sub) {
    await ctx.reply("Подкатегория уже удалена.");
    return;
  }

  data.products = data.products.filter(function (p) {
    return String(p.subcategoryId) !== String(sub.id);
  });

  data.subcategories = data.subcategories.filter(function (s) {
    return String(s.id) !== String(sub.id);
  });

  await shopSave(data);
  await ctx.reply("🗑 Подкатегория и её товары удалены.",
    shopKeyboard([
      [shopButton("📂 Подкатегории", "shop_admin_subcategories")],
      [shopButton("⚙️ Админ-панель", "shop_admin")]
    ]));
}

// ============================================================
// ADD CATEGORY / SUBCATEGORY / PRODUCT
// ============================================================

async function shopBeginAddCategory(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  data.steps[String(ctx.from.id)] = { step: "admin_category_name" };
  await shopSave(data);

  await ctx.reply("Введите название категории:",
    shopKeyboard([[shopButton("❌ Отмена", "shop_cancel_input")]]));
}

async function shopBeginAddSubcategory(ctx, categoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория не найдена.");
    return;
  }

  data.steps[String(ctx.from.id)] = {
    step: "admin_subcategory_name",
    categoryId: String(category.id)
  };

  await shopSave(data);
  await ctx.reply("Введите название подкатегории для «" + category.name + "»:",
    shopKeyboard([[shopButton("❌ Отмена", "shop_cancel_input")]]));
}

async function shopChooseSubcategoryCategory(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  if (!data.categories.length) {
    await ctx.reply("Сначала создайте категорию.");
    return;
  }

  const rows = data.categories.map(function (c) {
    return [shopButton("📁 " + c.name, "shop_admin_addsubcategory_to_" + c.id)];
  });

  rows.push([shopButton("⬅️ Назад", "shop_admin_subcategories")]);
  await ctx.reply("Выберите категорию:", shopKeyboard(rows));
}

async function shopBeginAddProduct(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();

  if (!data.categories.length) {
    await ctx.reply("Сначала создайте категорию.",
      shopKeyboard([
        [shopButton("➕ Создать категорию", "shop_admin_addcategory")],
        [shopButton("⬅️ Админ-панель", "shop_admin")]
      ]));
    return;
  }

  const rows = data.categories.map(function (c) {
    return [shopButton("📁 " + c.name, "shop_wiz_product_category_" + c.id)];
  });

  rows.push([shopButton("❌ Отмена", "shop_cancel_input")]);
  await ctx.reply("➕ ДОБАВЛЕНИЕ ТОВАРА\n\n1/6. Выберите категорию:",
    shopKeyboard(rows));
}

async function shopChooseProductSubcategory(ctx, categoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория не найдена.");
    return;
  }

  const subs = data.subcategories.filter(function (s) {
    return String(s.categoryId) === String(category.id);
  });

  const rows = subs.map(function (s) {
    return [shopButton("📂 " + s.name,
      "shop_wiz_product_sub_" + category.id + "_" + s.id)];
  });

  rows.push([shopButton("📁 Без подкатегории",
    "shop_wiz_product_sub_none_" + category.id)]);
  rows.push([shopButton("❌ Отмена", "shop_cancel_input")]);

  await ctx.reply("Категория: " + category.name + "\n\n2/6. Выберите подкатегорию:",
    shopKeyboard(rows));
}

async function shopStartProductFields(ctx, categoryId, subcategoryId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const category = shopFindCategory(data, categoryId);

  if (!category) {
    await ctx.reply("Категория не найдена.");
    return;
  }

  if (subcategoryId) {
    const sub = shopFindSubcategory(data, subcategoryId);
    if (!sub || String(sub.categoryId) !== String(category.id)) {
      await ctx.reply("Подкатегория не принадлежит выбранной категории.");
      return;
    }
  }

  data.steps[String(ctx.from.id)] = {
    step: "admin_product_name",
    categoryId: String(category.id),
    subcategoryId: subcategoryId ? String(subcategoryId) : ""
  };

  await shopSave(data);
  await ctx.reply("3/6. Введите название товара:",
    shopKeyboard([[shopButton("❌ Отмена", "shop_cancel_input")]]));
}

async function shopFinishNewProduct(ctx, data, userId, stepData, photo) {
  const category = shopFindCategory(data, stepData.categoryId);

  if (!category) {
    delete data.steps[userId];
    await shopSave(data);
    await ctx.reply("Категория не найдена.");
    return;
  }

  const id = shopId("p", data.counters.product++);

  const product = {
    id: id,
    categoryId: String(category.id),
    subcategoryId: stepData.subcategoryId || "",
    name: stepData.name,
    price: Number(stepData.price),
    stock: Number(stepData.stock),
    reserved: 0,
    status: Number(stepData.stock) > 0 ? "available" : "out",
    description: stepData.description || "",
    photo: photo || "",
    createdAt: Date.now()
  };

  data.products.push(product);
  delete data.steps[userId];
  await shopSave(data);

  await ctx.reply(
    "✅ Товар добавлен!\n\n" +
    "Название: " + product.name + "\n" +
    "ID: " + product.id + "\n" +
    "Цена: " + shopMoney(product.price) + "\n" +
    "Остаток: " + product.stock + "\n" +
    "Статус: " + shopStatusText(product.status),
    shopKeyboard([
      [shopButton("➕ Добавить ещё товар", "shop_admin_addproduct")],
      [shopButton("📦 Товары и склад", "shop_admin_products")],
      [shopButton("⬅️ Админ-панель", "shop_admin")]
    ])
  );
}

// ============================================================
// PRODUCTS AND STOCK
// ============================================================

async function shopAdminProducts(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();

  if (!data.products.length) {
    await ctx.reply("Товаров пока нет.",
      shopKeyboard([
        [shopButton("➕ Добавить товар", "shop_admin_addproduct")],
        [shopButton("⬅️ Админ-панель", "shop_admin")]
      ]));
    return;
  }

  const rows = data.products.slice().sort(shopProductSort).map(function (p) {
    return [shopButton(
      (p.status === "available" ? "🟢 " :
        p.status === "transit" ? "🚚 " : "🔴 ") +
      p.name + " · " + shopMoney(p.price),
      "shop_manage_product_" + p.id
    )];
  });

  rows.push([shopButton("➕ Добавить товар", "shop_admin_addproduct")]);
  rows.push([shopButton("⬅️ Админ-панель", "shop_admin")]);

  await ctx.reply("📦 ТОВАРЫ И СКЛАД\n\nСначала доступные, затем в дороге, затем закончившиеся:",
    shopKeyboard(rows));
}

async function shopManageProduct(ctx, productId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const p = shopFindProduct(data, productId);

  if (!p) {
    await ctx.reply("Товар не найден.");
    return;
  }

  await ctx.reply(
    "📦 " + p.name + "\n\n" +
    "ID: " + p.id + "\n" +
    "Цена: " + shopMoney(p.price) + "\n" +
    "На складе: " + p.stock + "\n" +
    "Зарезервировано: " + Number(p.reserved || 0) + "\n" +
    "Свободно: " + shopFreeStock(p) + "\n" +
    "Статус: " + shopStatusText(p.status) + "\n" +
    "Описание: " + (p.description || "нет"),
    shopKeyboard([
      [shopButton("✏️ Изменить название", "shop_edit_name_" + p.id),
       shopButton("💰 Изменить цену", "shop_edit_price_" + p.id)],
      [shopButton("📝 Изменить описание", "shop_edit_description_" + p.id)],
      [shopButton("🖼 Изменить фото", "shop_edit_photo_" + p.id)],
      [shopButton("🔢 Изменить остаток", "shop_edit_stock_" + p.id)],
      [shopButton("📌 Изменить статус", "shop_edit_status_" + p.id)],
      [shopButton("🗑 Удалить товар", "shop_delete_product_" + p.id)],
      [shopButton("⬅️ Все товары", "shop_admin_products")]
    ])
  );
}

async function shopBeginEditProductField(ctx, productId, field) {
  if (!(await shopAdminOnly(ctx))) return;

  const allowed = {
    name: { step: "admin_edit_product_name", prompt: "Введите новое название товара:" },
    price: { step: "admin_edit_product_price", prompt: "Введите новую цену числом, например 125.50:" },
    description: { step: "admin_edit_product_description", prompt: "Введите новое описание товара. Чтобы очистить описание, отправьте - :" },
    photo: { step: "admin_edit_product_photo", prompt: "Отправьте новую фотографию товара. Чтобы удалить фотографию, нажмите кнопку ниже." }
  };
  const config = allowed[field];
  if (!config) {
    await ctx.reply("Неизвестное поле товара.");
    return;
  }

  const data = await shopLoad();
  const p = shopFindProduct(data, productId);
  if (!p) {
    await ctx.reply("Товар не найден. Обновите список товаров и выберите его заново.");
    return;
  }

  data.steps[String(ctx.from.id)] = {
    step: config.step,
    productId: String(p.id)
  };
  await shopSave(data);

  const rows = [[shopButton("❌ Отмена", "shop_cancel_input")]];
  if (field === "photo") rows.unshift([shopButton("🗑 Удалить фотографию", "shop_edit_photo_remove_" + p.id)]);
  await ctx.reply(config.prompt + "\n\nТовар: " + p.name, shopKeyboard(rows));
}

async function shopFinishEditProductField(ctx, data, uid, step, value) {
  const p = shopFindProduct(data, step.productId);
  if (!p) {
    delete data.steps[uid];
    await shopSave(data);
    await ctx.reply("Товар не найден. Изменение отменено.");
    return;
  }

  if (step.step === "admin_edit_product_name") {
    if (value.length < 2) {
      await ctx.reply("Название слишком короткое. Введите минимум 2 символа.");
      return;
    }
    p.name = value;
  } else if (step.step === "admin_edit_product_price") {
    const price = Number(value.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) {
      await ctx.reply("Введите корректную цену: число от 0 и выше.");
      return;
    }
    p.price = price;
  } else if (step.step === "admin_edit_product_description") {
    p.description = value === "-" ? "" : value;
  } else {
    await ctx.reply("Неизвестный тип редактирования.");
    return;
  }

  delete data.steps[uid];
  await shopSave(data);
  await ctx.reply("✅ Данные товара обновлены.", shopKeyboard([
    [shopButton("📦 Открыть товар", "shop_manage_product_" + p.id)],
    [shopButton("📦 Все товары", "shop_admin_products")]
  ]));
}

async function shopBeginEditStock(ctx, productId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const p = shopFindProduct(data, productId);

  if (!p) {
    await ctx.reply("Товар не найден.");
    return;
  }

  data.steps[String(ctx.from.id)] = {
    step: "admin_stock_quantity",
    productId: String(p.id)
  };

  await shopSave(data);
  await ctx.reply("Введите новое количество на складе для «" + p.name + "»:",
    shopKeyboard([[shopButton("❌ Отмена", "shop_cancel_input")]]));
}

async function shopShowStatusChoices(ctx, productId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const p = shopFindProduct(data, productId);

  if (!p) {
    await ctx.reply("Товар не найден.");
    return;
  }

  await ctx.reply("Выберите статус товара «" + p.name + "»:",
    shopKeyboard([
      [shopButton("🟢 В наличии", "shop_set_status_" + p.id + "_available")],
      [shopButton("🔴 Закончился", "shop_set_status_" + p.id + "_out")],
      [shopButton("🚚 В дороге", "shop_set_status_" + p.id + "_transit")],
      [shopButton("⬅️ Назад", "shop_manage_product_" + p.id)]
    ]));
}

async function shopSetProductStatus(ctx, productId, status) {
  if (!(await shopAdminOnly(ctx))) return;

  if (!["available", "out", "transit"].includes(status)) {
    await ctx.reply("Недопустимый статус.");
    return;
  }

  const data = await shopLoad();
  const p = shopFindProduct(data, productId);

  if (!p) {
    await ctx.reply("Товар не найден.");
    return;
  }

  if (status === "out" && Number(p.reserved || 0) > 0) {
    await ctx.reply(
      "Нельзя обнулить товар: " + p.reserved +
      " шт. зарезервировано в заказах. Сначала обработайте эти заказы."
    );
    return;
  }

  if (status === "out") p.stock = 0;

  if (status === "available" && shopFreeStock(p) <= 0) {
    await ctx.reply("Сначала установите остаток выше количества резерва.");
    return;
  }

  p.status = status;
  shopSyncProductStatus(p);
  if (status === "transit") p.status = "transit";

  await shopSave(data);
  await ctx.reply("✅ Статус обновлён: " + shopStatusText(p.status),
    shopKeyboard([
      [shopButton("⬅️ К товару", "shop_manage_product_" + p.id)],
      [shopButton("📦 Все товары", "shop_admin_products")]
    ]));
}

async function shopDeleteProductConfirm(ctx, productId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const p = shopFindProduct(data, productId);

  if (!p) {
    await ctx.reply("Товар не найден.");
    return;
  }

  const active = data.orders.some(function (o) {
    return ["new", "in_progress"].includes(o.status) &&
      (o.items || []).some(function (i) {
        return String(i.productId) === String(p.id);
      });
  });

  if (active) {
    await ctx.reply(
      "⚠️ Товар участвует в активном заказе. Сначала подтвердите или отмените заказ."
    );
    return;
  }

  await ctx.reply("Удалить товар «" + p.name + "»?",
    shopKeyboard([
      [shopButton("⚠️ Да, удалить", "shop_delete_product_yes_" + p.id)],
      [shopButton("❌ Отмена", "shop_manage_product_" + p.id)]
    ]));
}

async function shopDeleteProduct(ctx, productId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const p = shopFindProduct(data, productId);

  if (!p) {
    await ctx.reply("Товар уже удалён.");
    return;
  }

  const active = data.orders.some(function (o) {
    return ["new", "in_progress"].includes(o.status) &&
      (o.items || []).some(function (i) {
        return String(i.productId) === String(p.id);
      });
  });

  if (active || Number(p.reserved || 0) > 0) {
    await ctx.reply("Нельзя удалить товар, зарезервированный в активном заказе.");
    return;
  }

  data.products = data.products.filter(function (x) {
    return String(x.id) !== String(productId);
  });

  Object.keys(data.carts).forEach(function (uid) {
    data.carts[uid] = (data.carts[uid] || []).filter(function (line) {
      return String(line.productId) !== String(productId);
    });
  });

  await shopSave(data);
  await ctx.reply("🗑 Товар удалён.",
    shopKeyboard([
      [shopButton("📦 Все товары", "shop_admin_products")],
      [shopButton("⚙️ Админ-панель", "shop_admin")]
    ]));
}

// ============================================================
// ADMIN ORDERS
// ============================================================

async function shopAdminOrders(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const orders = data.orders.slice().sort(function (a, b) {
    return Number(b.createdAt) - Number(a.createdAt);
  }).slice(0, 30);

  if (!orders.length) {
    await ctx.reply("Заказов пока нет.",
      shopKeyboard([[shopButton("⬅️ Админ-панель", "shop_admin")]]));
    return;
  }

  const rows = orders.map(function (o) {
    return [shopButton(
      "№" + o.id + " · " + shopOrderStatusText(o.status),
      "shop_admin_order_" + o.id
    )];
  });

  rows.push([shopButton("⬅️ Админ-панель", "shop_admin")]);
  await ctx.reply("🧾 ЗАКАЗЫ:", shopKeyboard(rows));
}

async function shopAdminOrderInfo(ctx, orderId) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const order = shopFindOrder(data, orderId);

  if (!order) {
    await ctx.reply("Заказ не найден.");
    return;
  }

  await shopRenderAdminOrder(ctx, order);
}

// ============================================================
// GROUP MANAGEMENT
// ============================================================

async function shopRegisterGroup(chat, botStatus) {
  if (!chat || !chat.id ||
    !["group", "supergroup"].includes(chat.type)) return;

  const data = await shopLoad();
  const id = String(chat.id);

  if (botStatus === "left" || botStatus === "kicked") {
    data.groups = data.groups.filter(function (g) {
      return String(g.chatId) !== id;
    });
    await shopSave(data);
    return;
  }

  const group = {
    chatId: id,
    title: chat.title || ("Группа " + id),
    type: chat.type,
    updatedAt: Date.now()
  };

  const existing = data.groups.find(function (g) {
    return String(g.chatId) === id;
  });

  if (existing) Object.assign(existing, group);
  else data.groups.push(group);

  await shopSave(data);
}

async function shopAdminGroups(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();

  if (!data.groups.length) {
    await ctx.reply(
      "👥 Подключённых групп пока нет.\nДобавьте бота в группу.",
      shopKeyboard([
        [shopButton("🔄 Обновить", "shop_admin_groups")],
        [shopButton("⬅️ Админ-панель", "shop_admin")]
      ])
    );
    return;
  }

  const rows = data.groups.map(function (g, i) {
    return [shopButton("👥 " + g.title, "shop_group_info_" + i)];
  });

  rows.push([shopButton("📣 Рассылка по группам", "shop_broadcast_menu")]);
  rows.push([shopButton("⬅️ Админ-панель", "shop_admin")]);

  await ctx.reply("👥 ПОДКЛЮЧЁННЫЕ ГРУППЫ\nКоличество: " + data.groups.length,
    shopKeyboard(rows));
}

async function shopGroupInfo(ctx, index) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const g = data.groups[Number(index)];

  if (!g) {
    await ctx.reply("Группа не найдена.");
    return;
  }

  await ctx.reply(
    "👥 " + g.title + "\n\nID: " + g.chatId + "\nТип: " + g.type,
    shopKeyboard([
      [shopButton("🧪 Проверить отправку", "shop_group_test_" + index)],
      [shopButton("🗑 Удалить из списка", "shop_group_remove_" + index)],
      [shopButton("⬅️ Все группы", "shop_admin_groups")]
    ])
  );
}

async function shopTestGroup(ctx, index) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const g = data.groups[Number(index)];

  if (!g) {
    await ctx.reply("Группа не найдена.");
    return;
  }

  try {
    await bot.telegram.sendMessage(g.chatId, "✅ Проверочное сообщение от магазина.");
    await ctx.reply("✅ Сообщение отправлено в «" + g.title + "».");
  } catch (e) {
    console.error("SHOP GROUP TEST ERROR:", e);
    await ctx.reply("❌ Не удалось отправить сообщение. Проверьте права бота.");
  }
}

async function shopRemoveGroup(ctx, index) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const g = data.groups[Number(index)];

  if (!g) {
    await ctx.reply("Группа не найдена.");
    return;
  }

  data.groups.splice(Number(index), 1);
  await shopSave(data);

  await ctx.reply("🗑 Группа удалена из списка рассылки. Сам бот не удалён из группы.",
    shopKeyboard([
      [shopButton("⬅️ Все группы", "shop_admin_groups")],
      [shopButton("⚙️ Админ-панель", "shop_admin")]
    ]));
}

// ============================================================
// BROADCAST
// ============================================================

async function shopBroadcastMenu(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  await ctx.reply("📣 РАССЫЛКА\n\nКому отправить сообщение?",
    shopKeyboard([
      [shopButton("🌐 Во все группы", "shop_broadcast_all_groups")],
      [shopButton("👥 Выбрать группы", "shop_broadcast_select_groups")],
      [shopButton("🛍 Всем покупателям", "shop_broadcast_buyers")],
      [shopButton("⬅️ Админ-панель", "shop_admin")]
    ]));
}

async function shopBeginBroadcastContent(ctx, mode, targetIds) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const uid = String(ctx.from.id);

  data.broadcastMode[uid] = {
    mode: mode,
    targetIds: Array.isArray(targetIds) ? targetIds.map(String) : [],
    startedAt: Date.now()
  };

  delete data.steps[uid];
  await shopSave(data);

  await ctx.reply(
    "📣 Отправьте текст или фотографию с подписью.\nДля отмены нажмите кнопку.",
    shopKeyboard([[shopButton("❌ Отменить рассылку", "shop_cancel_input")]]));
}

async function shopBroadcastSelectGroups(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();

  if (!data.groups.length) {
    await ctx.reply("Нет подключённых групп.");
    return;
  }

  data.broadcastMode[String(ctx.from.id)] = {
    mode: "select_groups",
    targetIds: []
  };

  await shopSave(data);
  await shopRenderGroupSelection(ctx);
}

async function shopRenderGroupSelection(ctx) {
  const data = await shopLoad();
  const state = data.broadcastMode[String(ctx.from.id)];

  if (!state || state.mode !== "select_groups") {
    await ctx.reply("Выбор групп отменён.");
    return;
  }

  const selected = state.targetIds || [];
  const rows = data.groups.map(function (g, i) {
    return [shopButton(
      (selected.includes(String(g.chatId)) ? "✅ " : "▫️ ") + g.title,
      "shop_broadcast_toggle_" + i    )];
  });

  rows.push([
    shopButton("☑️ Все", "shop_broadcast_select_all"),
    shopButton("🧹 Снять выбор", "shop_broadcast_select_none")
  ]);
  rows.push([shopButton("➡️ Продолжить (" + selected.length + ")",
    "shop_broadcast_selected")]);
  rows.push([shopButton("❌ Отмена", "shop_cancel_input")]);

  await ctx.reply("👥 ВЫБОР ГРУПП\nВыбрано: " + selected.length,
    shopKeyboard(rows));
}

async function shopToggleBroadcastGroup(ctx, index) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const state = data.broadcastMode[String(ctx.from.id)];

  if (!state || state.mode !== "select_groups") {
    await ctx.reply("Сначала откройте выбор групп.");
    return;
  }

  const group = data.groups[Number(index)];
  if (!group) {
    await ctx.reply("Группа не найдена.");
    return;
  }

  if (!Array.isArray(state.targetIds)) state.targetIds = [];

  const id = String(group.chatId);
  const i = state.targetIds.indexOf(id);

  if (i >= 0) state.targetIds.splice(i, 1);
  else state.targetIds.push(id);

  await shopSave(data);
  await shopRenderGroupSelection(ctx);
}

async function shopBroadcastSelectAll(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const state = data.broadcastMode[String(ctx.from.id)];

  if (!state || state.mode !== "select_groups") {
    await ctx.reply("Сначала откройте выбор групп.");
    return;
  }

  state.targetIds = data.groups.map(function (g) {
    return String(g.chatId);
  });

  await shopSave(data);
  await shopRenderGroupSelection(ctx);
}

async function shopBroadcastSelectNone(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const state = data.broadcastMode[String(ctx.from.id)];

  if (!state || state.mode !== "select_groups") {
    await ctx.reply("Сначала откройте выбор групп.");
    return;
  }

  state.targetIds = [];
  await shopSave(data);
  await shopRenderGroupSelection(ctx);
}

async function shopBroadcastSelected(ctx) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const state = data.broadcastMode[String(ctx.from.id)];

  if (!state || state.mode !== "select_groups") {
    await ctx.reply("Сначала откройте выбор групп.");
    return;
  }

  if (!state.targetIds || !state.targetIds.length) {
    await ctx.reply("Выберите хотя бы одну группу.");
    return;
  }

  await shopBeginBroadcastContent(ctx, "selected_groups", state.targetIds);
}

async function shopSendBroadcast(ctx, content) {
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const uid = String(ctx.from.id);
  const state = data.broadcastMode[uid];

  if (!state || typeof state !== "object" || state.mode === "select_groups") {
    await ctx.reply("Рассылка не активна или выбор групп ещё не завершён.");
    return;
  }

  let targets = [];

  if (state.mode === "all_groups") {
    targets = data.groups.map(function (g) {
      return { id: String(g.chatId), name: g.title || String(g.chatId) };
    });
  } else if (state.mode === "selected_groups") {
    targets = data.groups.filter(function (g) {
      return (state.targetIds || []).includes(String(g.chatId));
    }).map(function (g) {
      return { id: String(g.chatId), name: g.title || String(g.chatId) };
    });
  } else if (state.mode === "buyers") {
    targets = data.users.map(function (u) {
      return { id: String(u.id), name: u.name || String(u.id) };
    });
  }

  delete data.broadcastMode[uid];
  await shopSave(data);

  if (!targets.length) {
    await ctx.reply("Получателей нет. Рассылка отменена.");
    return;
  }

  let sent = 0;
  let failed = 0;
  const failedNames = [];

  for (const target of targets) {
    try {
      if (content.type === "photo") {
        await bot.telegram.sendPhoto(target.id, content.photo,
          content.caption ? { caption: content.caption } : {});
      } else {
        await bot.telegram.sendMessage(target.id, content.text);
      }
      sent++;
    } catch (e) {
      failed++;
      if (failedNames.length < 10) failedNames.push(target.name);
      console.error("SHOP BROADCAST ERROR:", target.id, e);
    }
  }

  await ctx.reply(
    "📣 РАССЫЛКА ЗАВЕРШЕНА\n\n" +
    "Получателей: " + targets.length + "\n" +
    "Успешно: " + sent + "\nОшибок: " + failed +
    (failedNames.length ? "\n\nНе удалось:\n• " + failedNames.join("\n• ") : ""),
    shopKeyboard([
      [shopButton("📣 Новая рассылка", "shop_broadcast_menu")],
      [shopButton("⬅️ Админ-панель", "shop_admin")]
    ])
  );
}

// ============================================================
// CANCEL CURRENT INPUT
// ============================================================

async function shopCancelInput(ctx) {
  const data = await shopLoad();
  const uid = String(ctx.from.id);

  delete data.steps[uid];
  delete data.broadcastMode[uid];
  await shopSave(data);

  await ctx.reply("❌ Действие отменено.",
    shopKeyboard([
      [shopButton("⚙️ Админ-панель", "shop_admin")],
      [shopButton("🏠 Главное меню", "shop_home")]
    ]));
}

// ============================================================
// TEXT INPUT PROCESSOR
// ============================================================

async function shopProcessInput(ctx) {
  if (!ctx.message || !ctx.message.text || !ctx.from || !shopPrivateChat(ctx)) return;

  const uid = String(ctx.from.id);
  const message = ctx.message.text.trim();

  if (message === "/cancel") {
    await shopCancelInput(ctx);
    return;
  }

  if (message.startsWith("/") && message !== "/start") return;

  const data = await shopLoad();
  const broadcast = data.broadcastMode[uid];

  if (shopIsAdmin(ctx) && broadcast && typeof broadcast === "object") {
    if (broadcast.mode === "select_groups") {
      await ctx.reply("Сначала выберите группы кнопками.");
      return;
    }

    await shopSendBroadcast(ctx, { type: "text", text: message });
    return;
  }

  const step = data.steps[uid];
  if (!step) return;

  if (step.step === "cash_withdraw_amount") {
    if (!shopIsAdmin(ctx)) return;
    await shopCashFinishWithdraw(ctx, data, uid, step, message);
    return;
  }

  if (step.step === "admin_category_name") {
    if (!shopIsAdmin(ctx)) return;
    if (message.length < 2) {
      await ctx.reply("Название слишком короткое.");
      return;
    }

    const id = shopId("c", data.counters.category++);
    data.categories.push({ id: id, name: message });
    delete data.steps[uid];
    await shopSave(data);

    await ctx.reply("✅ Категория создана: " + message,
      shopKeyboard([
        [shopButton("➕ Добавить категорию", "shop_admin_addcategory")],
        [shopButton("⬅️ Админ-панель", "shop_admin")]
      ]));
    return;
  }

  if (step.step === "admin_subcategory_name") {
    if (!shopIsAdmin(ctx)) return;
    const category = shopFindCategory(data, step.categoryId);

    if (!category) {
      delete data.steps[uid];
      await shopSave(data);
      await ctx.reply("Категория не найдена.");
      return;
    }

    if (message.length < 2) {
      await ctx.reply("Название слишком короткое.");
      return;
    }

    const id = shopId("s", data.counters.subcategory++);
    data.subcategories.push({
      id: id,
      categoryId: String(category.id),
      name: message
    });

    delete data.steps[uid];
    await shopSave(data);

    await ctx.reply("✅ Подкатегория создана: " + message,
      shopKeyboard([
        [shopButton("➕ Ещё подкатегория", "shop_admin_addsubcategory")],
        [shopButton("⬅️ Админ-панель", "shop_admin")]
      ]));
    return;
  }

  if (step.step === "admin_product_name") {
    if (!shopIsAdmin(ctx)) return;
    if (message.length < 2) {
      await ctx.reply("Введите название товара.");
      return;
    }

    step.name = message;
    step.step = "admin_product_price";
    await shopSave(data);
    await ctx.reply("4/6. Введите цену числом, например 125.50.");
    return;
  }

  if (step.step === "admin_product_price") {
    if (!shopIsAdmin(ctx)) return;
    const price = Number(message.replace(",", "."));

    if (!Number.isFinite(price) || price < 0) {
      await ctx.reply("Введите корректную цену.");
      return;
    }

    step.price = price;
    step.step = "admin_product_stock";
    await shopSave(data);
    await ctx.reply("5/6. Введите количество товара целым числом.");
    return;
  }

  if (step.step === "admin_product_stock") {
    if (!shopIsAdmin(ctx)) return;
    const stock = Number(message);

    if (!Number.isInteger(stock) || stock < 0) {
      await ctx.reply("Количество должно быть целым числом от 0.");
      return;
    }

    step.stock = stock;
    step.step = "admin_product_description";
    await shopSave(data);
    await ctx.reply("6/6. Введите описание или отправьте - чтобы пропустить.");
    return;
  }

  if (step.step === "admin_product_description") {
    if (!shopIsAdmin(ctx)) return;

    step.description = message === "-" ? "" : message;
    step.step = "admin_product_photo";
    await shopSave(data);

    await ctx.reply("Отправьте фотографию товара или нажмите «Пропустить».",
      shopKeyboard([
        [shopButton("⏭ Пропустить фотографию", "shop_product_photo_skip")],
        [shopButton("❌ Отмена", "shop_cancel_input")]
      ]));
    return;
  }

  if (step.step === "admin_product_photo") {
    if (!shopIsAdmin(ctx)) return;

    if (message !== "-") {
      await ctx.reply("Отправьте фотографию или нажмите кнопку пропуска.");
      return;
    }

    await shopFinishNewProduct(ctx, data, uid, step, "");
    return;
  }

  if (["admin_edit_product_name", "admin_edit_product_price", "admin_edit_product_description"].includes(step.step)) {
    if (!shopIsAdmin(ctx)) return;
    await shopFinishEditProductField(ctx, data, uid, step, message);
    return;
  }

  if (step.step === "admin_edit_product_photo") {
    if (!shopIsAdmin(ctx)) return;
    await ctx.reply("Для изменения фотографии отправьте именно фотографию или нажмите «Удалить фотографию».");
    return;
  }

  if (step.step === "admin_stock_quantity") {
    if (!shopIsAdmin(ctx)) return;

    const quantity = Number(message);
    if (!Number.isInteger(quantity) || quantity < 0) {
      await ctx.reply("Введите целое количество от 0.");
      return;
    }

    const p = shopFindProduct(data, step.productId);

    if (!p) {
      delete data.steps[uid];
      await shopSave(data);
      await ctx.reply("Товар не найден.");
      return;
    }

    if (quantity < Number(p.reserved || 0)) {
      await ctx.reply(
        "Нельзя установить остаток меньше зарезервированного количества: " +
        p.reserved + "."
      );
      return;
    }

    p.stock = quantity;
    shopSyncProductStatus(p);
    delete data.steps[uid];
    await shopSave(data);

    await ctx.reply(
      "✅ Остаток обновлён.\n" + p.name +
      "\nНа складе: " + p.stock +
      "\nРезерв: " + Number(p.reserved || 0) +
      "\nДоступно: " + shopFreeStock(p) +
      "\nСтатус: " + shopStatusText(p.status),
      shopKeyboard([
        [shopButton("⬅️ К товару", "shop_manage_product_" + p.id)],
        [shopButton("📦 Все товары", "shop_admin_products")]
      ]));
    return;
  }

  if (step.step === "order_name") {
    if (message.length < 2) {
      await ctx.reply("Введите имя и фамилию.");
      return;
    }

    step.name = message;
    step.step = "order_phone";
    await shopSave(data);
    await ctx.reply("Введите номер телефона для связи.");
    return;
  }

  if (step.step === "order_phone") {
    if (message.length < 5) {
      await ctx.reply("Введите корректный номер телефона.");
      return;
    }

    step.phone = message;
    step.step = "order_address";
    await shopSave(data);
    await ctx.reply("Введите полный адрес доставки.");
    return;
  }

  if (step.step === "order_address") {
    if (message.length < 4) {
      await ctx.reply("Введите полный адрес доставки.");
      return;
    }

    await shopFinishCheckout(ctx, data, uid, step, message);
  }
}

// ============================================================
// COMMANDS
// ============================================================

bot.command("start", async function (ctx) {
  try {
    if (!shopPrivateChat(ctx)) {
      await shopRegisterGroup(ctx.chat, "member");
      return;
    }

    await shopRegisterUser(ctx);
    await shopMainMenu(ctx);
  } catch (e) {
    console.error("SHOP START ERROR:", e);
    await ctx.reply("Не удалось открыть магазин. Попробуйте ещё раз.");
  }
});

bot.command("shop", async function (ctx) {
  try {
    if (!shopPrivateChat(ctx)) return;
    await shopRegisterUser(ctx);
    await shopShowCategories(ctx);
  } catch (e) {
    console.error("SHOP CATALOG ERROR:", e);
    await ctx.reply("Не удалось открыть каталог.");
  }
});

bot.command("admin", async function (ctx) {
  try {
    await shopAdminMenu(ctx);
  } catch (e) {
    console.error("SHOP ADMIN ERROR:", e);
    await ctx.reply("Не удалось открыть админ-панель.");
  }
});

bot.command("ping", async function (ctx) {
  await ctx.reply("✅ Бот работает.");
});

// ============================================================
// MAIN MENU / CUSTOMER CALLBACKS
// ============================================================

bot.action("shop_home", async function (ctx) {
  await ctx.answerCbQuery();
  await shopMainMenu(ctx);
});

bot.action("shop_catalog", async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowCategories(ctx);
});

bot.action("shop_cart", async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowCart(ctx);
});

bot.action("shop_clearcart", async function (ctx) {
  await ctx.answerCbQuery();
  await shopClearCart(ctx);
});

bot.action("shop_checkout", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginCheckout(ctx);
});

bot.action("shop_cancel_input", async function (ctx) {
  await ctx.answerCbQuery();
  await shopCancelInput(ctx);
});

bot.action("shop_myorders", async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowMyOrders(ctx);
});

bot.action(/^shop_cat_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowCategory(ctx, ctx.match[1]);
});

bot.action(/^shop_sub_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowSubcategory(ctx, ctx.match[1]);
});

bot.action(/^shop_product_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowProduct(ctx, ctx.match[1]);
});

bot.action(/^shop_add_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopAddToCart(ctx, ctx.match[1]);
});

bot.action(/^shop_remove_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopRemoveFromCart(ctx, ctx.match[1]);
});

bot.action(/^shop_orderinfo_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowOrderInfo(ctx, ctx.match[1]);
});

// ============================================================
// ADMIN CALLBACKS
// ============================================================

bot.action("shop_admin", async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminMenu(ctx);
});

bot.action("shop_admin_categories", async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminCategories(ctx);
});

bot.action("shop_admin_subcategories", async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminSubcategories(ctx);
});

bot.action("shop_admin_addcategory", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginAddCategory(ctx);
});

bot.action("shop_admin_addsubcategory", async function (ctx) {
  await ctx.answerCbQuery();
  await shopChooseSubcategoryCategory(ctx);
});

bot.action(/^shop_admin_addsubcategory_to_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginAddSubcategory(ctx, ctx.match[1]);
});

bot.action(/^shop_admin_subcat_category_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminShowSubcategories(ctx, ctx.match[1]);
});

bot.action(/^shop_admin_subcat_info_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminSubcategoryInfo(ctx, ctx.match[1]);
});

bot.action(/^shop_admin_category_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminCategoryInfo(ctx, ctx.match[1]);
});

bot.action(/^shop_delete_cat_(?!yes_)(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopDeleteCategoryConfirm(ctx, ctx.match[1]);
});

bot.action(/^shop_delete_cat_yes_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopDeleteCategory(ctx, ctx.match[1]);
});

bot.action(/^shop_delete_sub_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopDeleteSubcategoryConfirm(ctx, ctx.match[1]);
});

bot.action(/^shop_delete_sub_yes_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopDeleteSubcategory(ctx, ctx.match[1]);
});

bot.action("shop_admin_addproduct", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginAddProduct(ctx);
});

bot.action(/^shop_wiz_product_category_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopChooseProductSubcategory(ctx, ctx.match[1]);
});

bot.action(/^shop_wiz_product_sub_(c\d+)_(s\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopStartProductFields(ctx, ctx.match[1], ctx.match[2]);
});

bot.action(/^shop_wiz_product_sub_none_(c\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopStartProductFields(ctx, ctx.match[1], "");
});

bot.action("shop_product_photo_skip", async function (ctx) {
  await ctx.answerCbQuery();
  if (!(await shopAdminOnly(ctx))) return;

  const data = await shopLoad();
  const uid = String(ctx.from.id);
  const step = data.steps[uid];

  if (!step || step.step !== "admin_product_photo") {
    await ctx.reply("Нет активного добавления товара.");
    return;
  }

  await shopFinishNewProduct(ctx, data, uid, step, "");
});

bot.action("shop_admin_products", async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminProducts(ctx);
});

bot.action(/^shop_manage_product_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopManageProduct(ctx, ctx.match[1]);
});

bot.action(/^shop_edit_name_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginEditProductField(ctx, ctx.match[1], "name");
});

bot.action(/^shop_edit_price_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginEditProductField(ctx, ctx.match[1], "price");
});

bot.action(/^shop_edit_description_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginEditProductField(ctx, ctx.match[1], "description");
});

bot.action(/^shop_edit_photo_(?!remove_)(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginEditProductField(ctx, ctx.match[1], "photo");
});

bot.action(/^shop_edit_photo_remove_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  if (!(await shopAdminOnly(ctx))) return;
  const data = await shopLoad();
  const p = shopFindProduct(data, ctx.match[1]);
  if (!p) {
    await ctx.reply("Товар не найден.");
    return;
  }
  p.photo = "";
  delete data.steps[String(ctx.from.id)];
  await shopSave(data);
  await ctx.reply("🗑 Фотография удалена.", shopKeyboard([
    [shopButton("📦 К товару", "shop_manage_product_" + p.id)],
    [shopButton("📦 Все товары", "shop_admin_products")]
  ]));
});

bot.action(/^shop_edit_stock_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopBeginEditStock(ctx, ctx.match[1]);
});

bot.action(/^shop_edit_status_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopShowStatusChoices(ctx, ctx.match[1]);
});

bot.action(/^shop_set_status_(.+)_(available|out|transit)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopSetProductStatus(ctx, ctx.match[1], ctx.match[2]);
});

bot.action(/^shop_delete_product_(?!yes_)(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopDeleteProductConfirm(ctx, ctx.match[1]);
});

bot.action(/^shop_delete_product_yes_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopDeleteProduct(ctx, ctx.match[1]);
});

// ============================================================
// ORDER CALLBACKS
// ============================================================

bot.action("shop_admin_orders", async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminOrders(ctx);
});

bot.action(/^shop_admin_order_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminOrderInfo(ctx, ctx.match[1]);
});

bot.action(/^shop_take_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  try {
    await shopTakeOrder(ctx, ctx.match[1]);
  } catch (e) {
    console.error("SHOP TAKE ORDER ERROR:", e);
    await ctx.reply("Не удалось взять заказ в работу.");
  }
});

bot.action(/^shop_confirm_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  try {
    await shopConfirmOrder(ctx, ctx.match[1]);
  } catch (e) {
    console.error("SHOP CONFIRM ERROR:", e);
    await ctx.reply("Не удалось подтвердить продажу.");
  }
});

bot.action(/^shop_cancel_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  try {
    await shopCancelOrder(ctx, ctx.match[1]);
  } catch (e) {
    console.error("SHOP CANCEL ERROR:", e);
    await ctx.reply("Не удалось отменить заказ.");
  }
});

bot.action(/^shop_no_username_(.+)$/, async function (ctx) {
  await ctx.answerCbQuery(
    "У клиента нет username. Найти его по Telegram ID через эту кнопку нельзя.",
    { show_alert: true }
  );
});

// ============================================================
// CASH CALLBACKS
// ============================================================

bot.action("shop_cash", async function (ctx) {
  await ctx.answerCbQuery();
  await shopCashMenu(ctx);
});

bot.action("shop_cash_history", async function (ctx) {
  await ctx.answerCbQuery();
  await shopCashHistory(ctx);
});

bot.action(/^shop_cash_history_(\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopCashHistory(ctx, ctx.match[1]);
});

bot.action(/^shop_cash_account_(\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopCashAccount(ctx, ctx.match[1]);
});

bot.action(/^shop_cash_withdraw_(\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopCashBeginWithdraw(ctx, ctx.match[1]);
});

// ============================================================
// GROUP CALLBACKS
// ============================================================

bot.action("shop_admin_groups", async function (ctx) {
  await ctx.answerCbQuery();
  await shopAdminGroups(ctx);
});

bot.action(/^shop_group_info_(\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopGroupInfo(ctx, ctx.match[1]);
});

bot.action(/^shop_group_test_(\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopTestGroup(ctx, ctx.match[1]);
});

bot.action(/^shop_group_remove_(\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopRemoveGroup(ctx, ctx.match[1]);
});

// ============================================================
// BROADCAST CALLBACKS
// ============================================================

bot.action("shop_broadcast_menu", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBroadcastMenu(ctx);
});

bot.action("shop_broadcast_all_groups", async function (ctx) {
  await ctx.answerCbQuery();
  const data = await shopLoad();

  if (!data.groups.length) {
    await ctx.reply("Нет подключённых групп.");
    return;
  }

  await shopBeginBroadcastContent(ctx, "all_groups", []);
});

bot.action("shop_broadcast_select_groups", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBroadcastSelectGroups(ctx);
});

bot.action("shop_broadcast_buyers", async function (ctx) {
  await ctx.answerCbQuery();
  const data = await shopLoad();

  if (!data.users.length) {
    await ctx.reply("Пока нет зарегистрированных покупателей.");
    return;
  }

  await shopBeginBroadcastContent(ctx, "buyers", []);
});

bot.action(/^shop_broadcast_toggle_(\d+)$/, async function (ctx) {
  await ctx.answerCbQuery();
  await shopToggleBroadcastGroup(ctx, ctx.match[1]);
});

bot.action("shop_broadcast_select_all", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBroadcastSelectAll(ctx);
});

bot.action("shop_broadcast_select_none", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBroadcastSelectNone(ctx);
});

bot.action("shop_broadcast_selected", async function (ctx) {
  await ctx.answerCbQuery();
  await shopBroadcastSelected(ctx);
});

// ============================================================
// GROUP AUTO-REGISTRATION
// ============================================================

bot.on("my_chat_member", async function (ctx) {
  try {
    const update = ctx.update && ctx.update.my_chat_member;
    if (!update || !update.chat) return;

    const status = update.new_chat_member && update.new_chat_member.status;
    await shopRegisterGroup(update.chat, status);
  } catch (e) {
    console.error("SHOP GROUP REGISTRATION ERROR:", e);
  }
});

// ============================================================
// MESSAGE HANDLER: TEXT, PHOTOS, BROADCASTS
// ============================================================

bot.on("message", async function (ctx) {
  try {
    if (!ctx.from || !ctx.message) return;

    if (ctx.chat && ["group", "supergroup"].includes(ctx.chat.type)) {
      await shopRegisterGroup(ctx.chat, "member");
      return;
    }

    if (!shopPrivateChat(ctx)) return;

    const uid = String(ctx.from.id);
    const data = await shopLoad();
    const broadcast = data.broadcastMode[uid];

    if (
      shopIsAdmin(ctx) &&
      broadcast &&
      typeof broadcast === "object" &&
      broadcast.mode !== "select_groups" &&
      ctx.message.photo &&
      ctx.message.photo.length
    ) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      await shopSendBroadcast(ctx, {
        type: "photo",
        photo: photo,
        caption: ctx.message.caption || ""
      });
      return;
    }

    const step = data.steps[uid];

    if (
      shopIsAdmin(ctx) &&
      step &&
      step.step === "admin_product_photo" &&
      ctx.message.photo &&
      ctx.message.photo.length
    ) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      await shopFinishNewProduct(ctx, data, uid, step, photo);
      return;
    }

    if (
      shopIsAdmin(ctx) &&
      step &&
      step.step === "admin_edit_product_photo" &&
      ctx.message.photo &&
      ctx.message.photo.length
    ) {
      const p = shopFindProduct(data, step.productId);
      if (!p) {
        delete data.steps[uid];
        await shopSave(data);
        await ctx.reply("Товар не найден. Изменение фотографии отменено.");
        return;
      }
      p.photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      delete data.steps[uid];
      await shopSave(data);
      await ctx.reply("✅ Фотография товара обновлена.", shopKeyboard([
        [shopButton("📦 К товару", "shop_manage_product_" + p.id)],
        [shopButton("📦 Все товары", "shop_admin_products")]
      ]));
      return;
    }

    if (ctx.message.text) {
      await shopRegisterUser(ctx);
      await shopProcessInput(ctx);
    }
  } catch (e) {
    console.error("SHOP MESSAGE ERROR:", e);
  }
});

// ============================================================
// TELEGRAM COMMAND MENU
// ============================================================
try {
  bot.telegram.setMyCommands([
    { command: "start", description: "Открыть магазин" },
    { command: "shop", description: "Открыть каталог" },
    { command: "admin", description: "Панель управления" },
    { command: "ping", description: "Проверить работу бота" },
    { command: "cancel", description: "Отменить действие" }
  ]).catch(function (e) {
    console.error("SHOP COMMAND MENU ERROR:", e);
  });
} catch (e) {
  console.error("SHOP COMMAND MENU ERROR:", e);
}

console.log("SHOP BOT CODE LOADED");