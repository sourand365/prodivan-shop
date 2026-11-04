require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Telegraf, Markup, Input } = require("telegraf");
const ExcelJS = require("exceljs");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN || TOKEN === "PASTE_PRODIVAN_BOT_TOKEN_HERE") {
  console.error("Заполните BOT_TOKEN в локальном файле .env");
  process.exit(1);
}
const ADMINS = { "5340322240": "Андрей", "688000422": "Александр" };
const ADMIN_IDS = Object.keys(ADMINS);
const GROUPS = ["Товары", "Аренда", "Комплектующие"];
const DATA_DIR = path.join(__dirname, "data");
const REPORTS_DIR = path.join(__dirname, "Отчёты");
fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "prodivan.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users(user_id TEXT PRIMARY KEY, username TEXT DEFAULT '', first_name TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS root_groups(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY AUTOINCREMENT, root_id INTEGER NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(root_id,name), FOREIGN KEY(root_id) REFERENCES root_groups(id));
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT DEFAULT '', price REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(category_id) REFERENCES categories(id));
CREATE TABLE IF NOT EXISTS carts(user_id TEXT NOT NULL, product_id INTEGER NOT NULL, qty INTEGER NOT NULL, PRIMARY KEY(user_id,product_id), FOREIGN KEY(user_id) REFERENCES users(user_id), FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT DEFAULT '', customer_name TEXT DEFAULT '', phone TEXT NOT NULL, tg_username TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', total REAL NOT NULL DEFAULT 0, final_total REAL NOT NULL DEFAULT 0, confirming_admin TEXT DEFAULT '', assigned_admin TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT, FOREIGN KEY(user_id) REFERENCES users(user_id));
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, qty INTEGER NOT NULL, unit_price REAL NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS cash_accounts(admin_id TEXT PRIMARY KEY, admin_name TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cash_movements(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, comment TEXT NOT NULL DEFAULT '', related_order INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS stock_movements(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, qty INTEGER NOT NULL, unit_cost REAL NOT NULL, payer TEXT NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS chat_targets(chat_id TEXT PRIMARY KEY, chat_type TEXT NOT NULL, title TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS product_media(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, media_type TEXT NOT NULL, file_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS order_admin_messages(order_id INTEGER NOT NULL, admin_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, PRIMARY KEY(order_id,admin_id));
CREATE TABLE IF NOT EXISTS expected_invoices(id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL DEFAULT 'draft', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, confirmed_by TEXT DEFAULT '', confirmed_at TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS expected_invoice_items(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, qty INTEGER NOT NULL, unit_cost REAL NOT NULL, unit_price REAL NOT NULL, FOREIGN KEY(invoice_id) REFERENCES expected_invoices(id) ON DELETE CASCADE, FOREIGN KEY(product_id) REFERENCES products(id));
`);
const categoryCols = db.prepare("PRAGMA table_info(categories)").all().map(c => c.name); if (!categoryCols.includes("active")) db.exec("ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
const productCols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name); if (!productCols.includes("reserved")) db.exec("ALTER TABLE products ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0");
const orderCols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name); if (!orderCols.includes("assigned_admin")) db.exec("ALTER TABLE orders ADD COLUMN assigned_admin TEXT DEFAULT ''");
 // Rebuild the admin-only reserve from all orders that are still open, including orders created before this update.
db.prepare("UPDATE products SET reserved=COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=products.id AND o.status IN ('new','in_progress')),0)").run();
const run = db.prepare("INSERT OR IGNORE INTO root_groups(name) VALUES(?)");
GROUPS.forEach(x => run.run(x));
const cashInit = db.prepare("INSERT OR IGNORE INTO cash_accounts(admin_id,admin_name,balance) VALUES(?,?,0)");
Object.entries(ADMINS).forEach(([id,name]) => cashInit.run(id,name));

const bot = new Telegraf(TOKEN);
const states = new Map();
const broadcastStates = new Map();
const mediaStates = new Map();
// Remember private users and groups/channels that interact with the bot.
bot.use(async (ctx, next) => {
  try {
    const chat = ctx.chat;
    if (chat && (chat.type === "group" || chat.type === "supergroup" || chat.type === "channel")) {
      db.prepare("INSERT INTO chat_targets(chat_id,chat_type,title,active) VALUES(?,?,?,1) ON CONFLICT(chat_id) DO UPDATE SET chat_type=excluded.chat_type,title=excluded.title,active=1")
        .run(String(chat.id), chat.type, chat.title || "");
    } else if (ctx.from && chat && chat.type === "private") {
      db.prepare("INSERT INTO chat_targets(chat_id,chat_type,title,active) VALUES(?,?,?,1) ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title,active=1")
        .run(String(chat.id), "private", ctx.from.first_name || ctx.from.username || "");
    }
  } catch (e) { console.error("Не удалось обновить список получателей рассылки:", e.message); }
  return next();
});
const setState = (id,s) => states.set(String(id),s);
const getState = id => states.get(String(id));
const clearState = id => states.delete(String(id));
const admin = id => Boolean(ADMINS[String(id)]);
const cash = n => Number(n || 0).toFixed(2) + " грн";
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

const REPORT_TZ = "Europe/Kyiv";
function kyivParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(value);
  return Object.fromEntries(parts.filter(x => x.type !== "literal").map(x => [x.type, x.value]));
}
function kyivDate(value) {
  if (!value) return "";
  const raw = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  const p = kyivParts(date);
  return p.year + "-" + p.month + "-" + p.day;
}
function dateInPeriod(value, period) {
  const d = kyivDate(value);
  return d >= period.startDate && d <= period.endDate;
}
function isoWeekInfo(dateKey) {
  const d = new Date(dateKey + "T00:00:00Z");
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year, week, key: year + "-W" + String(week).padStart(2, "0") };
}
function addDays(dateKey, amount) {
  const d = new Date(dateKey + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
function periodFor(type, today) {
  if (type === "daily") return { startDate: today, endDate: today, folder: path.join(REPORTS_DIR, "Ежедневные", today), file: "Отчёт_" + today + ".xlsx", title: "Ежедневный отчёт " + today };
  if (type === "weekly") {
    const d = new Date(today + "T00:00:00Z");
    const weekday = d.getUTCDay() || 7;
    const startDate = addDays(today, 1 - weekday);
    const info = isoWeekInfo(today);
    return { startDate, endDate: today, folder: path.join(REPORTS_DIR, "Еженедельные", info.key), file: "Отчёт_" + info.key + ".xlsx", title: "Еженедельный отчёт " + info.key };
  }
  const startDate = today.slice(0, 7) + "-01";
  return { startDate, endDate: today, folder: path.join(REPORTS_DIR, "Ежемесячные", today.slice(0, 7)), file: "Отчёт_" + today.slice(0, 7) + ".xlsx", title: "Ежемесячный отчёт " + today.slice(0, 7) };
}
function styleSheet(sheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF305496" } };
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  sheet.autoFilter = sheet.rowCount ? { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: Math.max(1, sheet.columnCount) } } : undefined;
  for (const col of sheet.columns) {
    let max = 12;
    col.eachCell({ includeEmpty: false }, cell => { max = Math.max(max, String(cell.value ?? "").length + 2); });
    col.width = Math.min(max, 36);
  }
  sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: "top", wrapText: true }; }));
}
function addReportSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(([header, key, width]) => ({ header, key, width: width || 18 }));
  sheet.addRows(rows);
  styleSheet(sheet);
  return sheet;
}
async function createExcelReport(type, today = kyivDate(new Date())) {
  const period = periodFor(type, today);
  fs.mkdirSync(period.folder, { recursive: true });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Продаван";
  workbook.created = new Date();
  workbook.subject = period.title + " · Europe/Kyiv";
  workbook.title = period.title;
  const products = db.prepare("SELECT p.id,p.name,p.description,p.price,p.stock,p.reserved,p.active,c.name AS category,r.name AS root FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN root_groups r ON r.id=c.root_id ORDER BY r.id,c.name,p.name").all();
  const stockRows = products.map(p => ({
    ID: p.id, Раздел: p.root || "", Категория: p.category || "", Товар: p.name,
    Цена: Number(p.price || 0), Остаток: Number(p.stock || 0), Резерв: Number(p.reserved || 0),
    Свободно: Math.max(0, Number(p.stock || 0) - Number(p.reserved || 0)),
    Активен: p.active ? "Да" : "Нет", Описание: p.description || ""
  }));
  const stockPurchase = products.reduce((sum,p)=>{const batches=db.prepare("SELECT COALESCE(SUM(qty),0) AS qty,COALESCE(SUM(qty*unit_cost),0) AS cost FROM stock_movements WHERE product_id=?").get(p.id);const average=batches.qty>0?batches.cost/batches.qty:0;return sum+Math.max(0,Number(p.stock||0))*average;},0);
  const stockSale = products.reduce((sum,p)=>sum+Math.max(0,Number(p.stock||0))*Number(p.price||0),0);
  addReportSheet(workbook, "Оценка склада", [["Показатель","Показатель",38],["Сумма, грн","Сумма",22]], [
    {Показатель:"Закупочная стоимость склада",Сумма:stockPurchase},
    {Показатель:"Продажная стоимость склада",Сумма:stockSale},
    {Показатель:"Потенциальная прибыль",Сумма:stockSale-stockPurchase}
  ]);
  addReportSheet(workbook, "Склад", [
    ["ID","ID",10],["Главный раздел","Раздел",20],["Категория","Категория",24],["Товар","Товар",30],
    ["Цена, грн","Цена",14],["Остаток","Остаток",12],["Резерв","Резерв",12],["Свободно","Свободно",12],
    ["Активен","Активен",12],["Описание","Описание",36]
  ], stockRows);
  const allOrders = db.prepare("SELECT * FROM orders ORDER BY id").all();
  const orderRows = allOrders.filter(o => dateInPeriod(o.created_at, period)).map(o => ({
    Заказ: o.id, Создан: o.created_at, Статус: o.status, Покупатель: o.customer_name || o.username || "",
    Телефон: o.phone, Юз: o.tg_username, СуммаКаталога: Number(o.total || 0),
    ИтогКлиента: Number(o.final_total || 0), Ответственный: ADMINS[String(o.assigned_admin || "")] || "",
    Подтвердил: ADMINS[String(o.confirming_admin || "")] || ""
  }));
  addReportSheet(workbook, "Заказы", [
    ["№ заказа","Заказ",12],["Создано (UTC)","Создан",22],["Статус","Статус",16],["Покупатель","Покупатель",24],
    ["Телефон","Телефон",18],["Telegram юз","Юз",22],["Сумма по каталогу, грн","СуммаКаталога",20],
    ["Итог клиента, грн","ИтогКлиента",18],["Ответственный","Ответственный",18],["Подтвердил","Подтвердил",18]
  ], orderRows);
  const confirmed = allOrders.filter(o => o.status === "confirmed" && dateInPeriod(o.updated_at || o.created_at, period));
  const salesRows = [];
  for (const o of confirmed) {
    const items = db.prepare("SELECT product_name,qty,unit_price FROM order_items WHERE order_id=? ORDER BY id").all(o.id);
    for (const item of items) salesRows.push({
      Заказ: o.id, Дата: kyivDate(o.updated_at || o.created_at), Товар: item.product_name,
      Количество: Number(item.qty), ЦенаКаталога: Number(item.unit_price),
      СуммаСтроки: Number(item.qty) * Number(item.unit_price),
      ИтогВсегоЗаказа: Number(o.final_total || 0), СкидкаИлиКорректировка: Number(o.total || 0) - Number(o.final_total || 0),
      Касса: ADMINS[String(o.confirming_admin || "")] || ""
    });
  }
  addReportSheet(workbook, "Продажи", [
    ["Заказ","Заказ",12],["Дата продажи","Дата",16],["Товар","Товар",28],["Количество","Количество",14],
    ["Цена каталога, грн","ЦенаКаталога",18],["Сумма по каталогу, грн","СуммаСтроки",20],
    ["Итог заказа, грн","ИтогВсегоЗаказа",18],["Разница со скидкой, грн","СкидкаИлиКорректировка",22],["Касса администратора","Касса",20]
  ], salesRows);
  const accounts = db.prepare("SELECT * FROM cash_accounts ORDER BY admin_name").all();
  addReportSheet(workbook, "Кассы", [
    ["ID администратора","ID администратора",20],["Администратор","Администратор",20],["Текущий баланс, грн","Текущий баланс, грн",22]
  ], accounts.map(a => ({ "ID администратора": a.admin_id, Администратор: a.admin_name, "Текущий баланс, грн": Number(a.balance || 0) })));
  const cashRows = db.prepare("SELECT m.*,a.admin_name FROM cash_movements m JOIN cash_accounts a ON a.admin_id=m.account_id ORDER BY m.id").all()
    .filter(m => dateInPeriod(m.created_at, period))
    .map(m => ({
      ID: m.id, Дата: m.created_at, Касса: m.admin_name, Тип: m.type, Сумма: Number(m.amount),
      Комментарий: m.comment || "", Заказ: m.related_order || "", КтоВыполнил: ADMINS[String(m.actor_id)] || m.actor_id
    }));
  addReportSheet(workbook, "История касс", [
    ["ID","ID",10],["Дата (UTC)","Дата",22],["Касса","Касса",18],["Операция","Тип",18],
    ["Сумма, грн","Сумма",16],["Комментарий","Комментарий",34],["№ заказа","Заказ",12],["Кто выполнил","КтоВыполнил",20]
  ], cashRows);
  const stockRowsPeriod = db.prepare("SELECT sm.*,p.name AS product_name FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id ORDER BY sm.id").all()
    .filter(m => dateInPeriod(m.created_at, period))
    .map(m => ({
      ID: m.id, Дата: m.created_at, Товар: m.product_name || ("ID " + m.product_id),
      Количество: Number(m.qty), СебестоимостьЕд: Number(m.unit_cost), ОбщаяСебестоимость: Number(m.qty) * Number(m.unit_cost),
      КтоОплатил: m.payer, Комментарий: m.comment || ""
    }));
  addReportSheet(workbook, "Поступления", [
    ["ID","ID",10],["Дата (UTC)","Дата",22],["Товар","Товар",28],["Количество","Количество",14],
    ["Себестоимость за единицу, грн","СебестоимостьЕд",24],["Себестоимость всего, грн","ОбщаяСебестоимость",24],
    ["Кто оплатил","КтоОплатил",18],["Комментарий","Комментарий",32]
  ], stockRowsPeriod);
  const pendingInvoices = db.prepare("SELECT * FROM expected_invoices WHERE status='pending' ORDER BY id").all();
  const expectedRows = [];
  const expectedTotals = new Map();
  for (const inv of pendingInvoices) for (const it of db.prepare("SELECT * FROM expected_invoice_items WHERE invoice_id=? ORDER BY id").all(inv.id)) {
    const qty = Number(it.qty || 0), unitCost = Number(it.unit_cost || 0), unitPrice = Number(it.unit_price || 0);
    const key = String(it.product_id);
    const total = expectedTotals.get(key) || { Товар: it.product_name, Всего: 0, ЗакупочнаяСумма: 0 };
    total.Всего += qty; total.ЗакупочнаяСумма += qty * unitCost; expectedTotals.set(key, total);
    expectedRows.push({ ProductId:it.product_id, Накладная:inv.id, Создана:inv.created_at, Товар:it.product_name, Количество:qty,
      ВсегоПоТовару:0, СредняяЗакупка:0, ЗакупкаЗаЕд:unitCost, ПродажаЗаЕд:unitPrice,
      ЗакупкаВсего:qty*unitCost, ПродажаВсего:qty*unitPrice, Статус:"Ожидается" });
  }
  for (const row of expectedRows) {
    const total = expectedTotals.get(String(row.ProductId));
    if (total) { row.ВсегоПоТовару=total.Всего; row.СредняяЗакупка=total.Всего?total.ЗакупочнаяСумма/total.Всего:0; }
  }
  addReportSheet(workbook, "Сводка ожидаемых товаров", [
    ["Товар","Товар",32],["Всего ожидается, шт.","Всего",20],["Средняя закупочная цена, грн","СредняяЗакупка",26],
    ["Общая закупочная стоимость, грн","ЗакупочнаяСумма",28]
  ], Array.from(expectedTotals.values()).map(x=>({Товар:x.Товар,Всего:x.Всего,СредняяЗакупка:x.Всего?x.ЗакупочнаяСумма/x.Всего:0,ЗакупочнаяСумма:x.ЗакупочнаяСумма})));
  addReportSheet(workbook, "Ожидаемые поставки", [
    ["№ накладной","Накладная",14],["Создана","Создана",22],["Товар","Товар",28],["Количество в накладной","Количество",18],
    ["Всего по товару, шт.","ВсегоПоТовару",18],["Средняя закупка, грн","СредняяЗакупка",20],
    ["Закупка за ед., грн","ЗакупкаЗаЕд",18],["Продажа за ед., грн","ПродажаЗаЕд",18],
    ["Закупка всего, грн","ЗакупкаВсего",20],["Продажа всего, грн","ПродажаВсего",20],["Статус","Статус",16]
  ], expectedRows);
  const filePath = path.join(period.folder, period.file);
  await workbook.xlsx.writeFile(filePath);
  return { filePath, title: period.title, period };
}
async function sendDailyExcelReport(adminId) {
  const report = await createExcelReport("daily");
  await bot.telegram.sendDocument(String(adminId), Input.fromLocalFile(report.filePath, path.basename(report.filePath)), {
    caption: report.title + "\nПериод: " + report.period.startDate + " — " + report.period.endDate + "\nФайл также сохранён локально."
  });
  return report;
}
const reportRuns = new Set();
async function scheduledExcelReports() {
  const p = kyivParts(new Date());
  if (p.hour !== "23" || p.minute !== "55") return;
  const today = p.year + "-" + p.month + "-" + p.day;
  const marker = today + " 23:55";
  if (reportRuns.has(marker)) return;
  reportRuns.add(marker);
  try {
    const daily = await createExcelReport("daily", today);
    console.log("Excel ежедневный отчёт сохранён:", daily.filePath);
    const d = new Date(today + "T00:00:00Z");
    const weekday = d.getUTCDay();
    if (weekday === 0) {
      const weekly = await createExcelReport("weekly", today);
      console.log("Excel недельный отчёт сохранён:", weekly.filePath);
    }
    const tomorrow = addDays(today, 1);
    if (tomorrow.slice(0, 7) !== today.slice(0, 7)) {
      const monthly = await createExcelReport("monthly", today);
      console.log("Excel месячный отчёт сохранён:", monthly.filePath);
    }
  } catch (e) {
    console.error("Не удалось сформировать Excel-отчёт:", e);
    reportRuns.delete(marker);
  }
}

async function roots(ctx) {
  if (!ctx.chat || ctx.chat.type !== "private") {
    return ctx.reply("Каталог доступен только в личных сообщениях с ботом.");
  }
  // Ensure the three fixed top-level sections exist even if the local database
  // was created by an older version of the bot.
  const insertRoot = db.prepare("INSERT OR IGNORE INTO root_groups(name) VALUES(?)");
  for (const name of GROUPS) insertRoot.run(name);
  const groups = db.prepare(`
    SELECT id, name FROM root_groups
    ORDER BY CASE name
      WHEN 'Товары' THEN 1
      WHEN 'Аренда' THEN 2
      WHEN 'Комплектующие' THEN 3
      ELSE 4
    END, id
  `).all();
  if (!groups.length) return ctx.reply("Разделы каталога пока недоступны. Обратитесь к администратору.");
  const rows = groups.map(group => [Markup.button.callback(group.name, "root:" + group.id)]);
  return ctx.reply("🛍 Каталог «Продаван»\nВыберите раздел:", Markup.inlineKeyboard(rows));
}

const rootId = name => db.prepare("SELECT id FROM root_groups WHERE name=?").get(name)?.id;
const homeKb = id => Markup.keyboard(admin(id) ? [["🛍 Каталог","🛒 Корзина"],["📦 Мои заказы","🛠 Админ-панель"]] : [["🛍 Каталог","🛒 Корзина"],["📦 Мои заказы"]]).resize();
const adminKb = () => Markup.inlineKeyboard([
  [Markup.button.callback("➕ Категория","a:cat"),Markup.button.callback("➕ Товар","a:product")],
  [Markup.button.callback("✏️ Изменить товар","a:editproduct"),Markup.button.callback("🗑 Удалить товар","a:delproduct")],
  [Markup.button.callback("✏️ Изменить категорию","a:editcat"),Markup.button.callback("🗑 Удалить категорию","a:delcat")],
  [Markup.button.callback("📦 Приход / склад","a:stock"),Markup.button.callback("💵 Кассы","a:cash")],
  [Markup.button.callback("📋 Все товары","a:allproducts")],
  [Markup.button.callback("♻️ Удалённые: удалить навсегда","a:purgeproducts")],
  [Markup.button.callback("🚚 Ожидаемые поставки","a:expected")],
  [Markup.button.callback("📊 Excel ожидаемых","a:expectedexcel")],
  [Markup.button.callback("📜 История касс","a:history"),Markup.button.callback("📋 Заказы","a:orders")],
  [Markup.button.callback("📊 Excel-отчёт","a:excel")],
  [Markup.button.callback("📣 Рассылка","a:broadcast")]
]);

const cancelKb = () => Markup.keyboard([["❌ Отмена"]]).resize();
function orderContactUrl(order) {
  const username = String(order.tg_username || "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? "https://t.me/" + username : "";
}
function orderKeyboard(order, adminId) {
  const owner = String(order.assigned_admin || "");
  if (order.status === "new" && !owner) return Markup.inlineKeyboard([[Markup.button.callback("🛠 Взять в работу", "order:take:" + order.id)]]);
  if (order.status !== "in_progress" || owner !== String(adminId)) return undefined;
  const rows = [
    [Markup.button.callback("✅ Подтвердить", "confirm:" + order.id), Markup.button.callback("❌ Отменить", "cancel:" + order.id)],
    [Markup.button.callback("↪️ Передать заказ", "order:transfer:" + order.id)]
  ];
  const url = orderContactUrl(order);
  if (url) rows.push([Markup.button.url("💬 Написать клиенту", url)]);
  return Markup.inlineKeyboard(rows);
}
function canManageOrder(order, adminId) {
  return !!order && order.status === "in_progress" && String(order.assigned_admin || "") === String(adminId);
}
async function refreshOrderAdminMessages(orderId) {
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
  if (!order) return;
  const messages = db.prepare("SELECT admin_id,chat_id,message_id FROM order_admin_messages WHERE order_id=?").all(orderId);
  for (const m of messages) {
    const keyboard = orderKeyboard(order, m.admin_id);
    try {
      await bot.telegram.editMessageReplyMarkup(m.chat_id, m.message_id, undefined, keyboard ? keyboard.reply_markup : { inline_keyboard: [] });
    } catch (e) {
      if (!/message is not modified/i.test(e.message || "")) console.error("Не удалось обновить кнопки заказа", orderId, m.admin_id, e.message);
    }
  }
}
async function sendOrderAdminMessage(adminId, order, text) {
  const keyboard = orderKeyboard(order, adminId);
  const sent = await bot.telegram.sendMessage(adminId, text, keyboard || {});
  db.prepare("INSERT INTO order_admin_messages(order_id,admin_id,chat_id,message_id) VALUES(?,?,?,?) ON CONFLICT(order_id,admin_id) DO UPDATE SET chat_id=excluded.chat_id,message_id=excluded.message_id")
    .run(order.id, String(adminId), String(adminId), sent.message_id);
}

function saveUser(ctx) {
  const u = ctx.from;
  db.prepare(`INSERT INTO users(user_id,username,first_name) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name`)
    .run(String(u.id),u.username || "",u.first_name || "");
}
async function sendProductCard(ctx, product) {
  const media = db.prepare("SELECT media_type,file_id FROM product_media WHERE product_id=? ORDER BY position,id").all(product.id);
  let photos = [];
  const flushPhotos = async () => {
    if (!photos.length) return;
    try {
      if (photos.length === 1) await ctx.replyWithPhoto(photos[0].media);
      else await ctx.telegram.sendMediaGroup(ctx.chat.id, photos);
    } catch (e) {
      console.error("Не удалось отправить альбом товара:", product.id, e.message);
      for (const item of photos) {
        try { await ctx.replyWithPhoto(item.media); } catch (inner) { console.error("Не удалось отправить фото товара:", inner.message); }
      }
    }
    photos = [];
  };
  for (const item of media) {
    if (item.media_type === "photo") {
      photos.push({ type: "photo", media: item.file_id });
      if (photos.length === 8) await flushPhotos();
    } else {
      await flushPhotos();
      try { await ctx.replyWithVideo(item.file_id); }
      catch (e) { console.error("Не удалось отправить видео товара:", product.id, e.message); }
    }
  }
  await flushPhotos();
  const inStock = Number(product.stock) > 0;
  await ctx.reply((inStock?"🟢 В наличии":"🔴 Нет в наличии")+"\n<b>"+esc(product.name)+"</b>\n"+esc(product.description||"")+"\nЦена: "+cash(product.price)+"\n"+(inStock?"Остаток: "+product.stock:"Товар закончился"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      ...(inStock ? [[Markup.button.callback("➕ В корзину","add:"+product.id)]] : []),
      [Markup.button.callback("⬅️ К списку товаров", "cat:"+product.category_id)]
    ])
  });
}
async function showCategoryProducts(ctx, categoryId) {
  const cat = db.prepare("SELECT id,name,root_id FROM categories WHERE id=? AND active=1").get(categoryId);
  if (!cat) return ctx.reply("Категория не найдена.");
  const products = db.prepare("SELECT id,name FROM products WHERE category_id=? AND active=1 AND stock>0 ORDER BY name").all(categoryId);
  if (!products.length) return ctx.reply("В категории «"+cat.name+"» пока нет товаров.");
  const rows = products.map(p => [Markup.button.callback(p.name, "product:"+p.id)]);
  rows.push([Markup.button.callback("🛍 Все товары", "catall:"+categoryId)]);
  rows.push([Markup.button.callback("⬅️ Назад к категориям", "root:"+cat.root_id)]);
  return ctx.reply("Категория «"+cat.name+"». Выберите товар по названию:", Markup.inlineKeyboard(rows));
}
async function showRootProducts(ctx, rootGroupId) {
  const products = db.prepare("SELECT p.id,p.name,p.description,p.price,p.stock,p.category_id FROM products p JOIN categories c ON c.id=p.category_id WHERE c.root_id=? AND c.active=1 AND p.active=1 AND p.stock>0 ORDER BY p.name").all(rootGroupId);
  if (!products.length) return ctx.reply("В этом разделе пока нет товаров.");
  for (const product of products) await sendProductCard(ctx, product);
}
bot.start(async ctx => {
  if(ctx.chat.type !== "private") return ctx.reply("Магазин «Продаван» работает только в личных сообщениях. Откройте бота напрямую: @"+(ctx.botInfo?.username || "bot"),Markup.removeKeyboard());
  saveUser(ctx); clearState(ctx.from.id);
  await ctx.reply("Привет! Это магазин «Продаван».",homeKb(ctx.from.id));
  if(admin(ctx.from.id)) await ctx.reply("Админ-панель:",adminKb());
});
bot.command("admin",ctx => ctx.chat.type!=="private" ? ctx.reply("Админ-панель доступна только в личных сообщениях.") : (admin(ctx.from.id) ? ctx.reply("Админ-панель:",adminKb()) : ctx.reply("Нет доступа.")));
bot.hears("🛠 Админ-панель",ctx => ctx.chat.type==="private" && admin(ctx.from.id) && ctx.reply("Админ-панель:",adminKb()));
bot.hears("🛍 Каталог",ctx => ctx.chat.type==="private" ? roots(ctx) : ctx.reply("Каталог доступен в личных сообщениях с ботом."));
bot.hears("🛒 Корзина",ctx => ctx.chat.type==="private" ? showCart(ctx) : ctx.reply("Корзина доступна в личных сообщениях с ботом."));
bot.hears("📦 Мои заказы",ctx => ctx.chat.type==="private" ? showOrders(ctx) : ctx.reply("Заказы доступны в личных сообщениях с ботом."));
bot.hears("❌ Отмена",async ctx => {clearState(ctx.from.id);mediaStates.delete(String(ctx.from.id));await ctx.reply("Действие отменено.",homeKb(ctx.from.id));});
bot.hears("✅ Готово с медиа",async ctx=>{if(!admin(ctx.from.id))return;mediaStates.delete(String(ctx.from.id));clearState(ctx.from.id);await ctx.reply("Медиа сохранено.",adminKb());});
bot.hears("🧹 Очистить медиа",async ctx=>{if(!admin(ctx.from.id))return;const m=mediaStates.get(String(ctx.from.id));if(!m)return ctx.reply("Сначала выберите товар.");db.prepare("DELETE FROM product_media WHERE product_id=?").run(m.productId);await ctx.reply("Старые фото и видео удалены. Теперь отправьте новые или нажмите «✅ Готово с медиа».");});

bot.action(/^root:(\d+)$/,async ctx => {
  await ctx.answerCbQuery();
  const rid=Number(ctx.match[1]);
  const r=db.prepare("SELECT name FROM root_groups WHERE id=?").get(rid);
  if(!r) return ctx.reply("Раздел не найден.");
  const cats=db.prepare("SELECT id,name FROM categories WHERE root_id=? AND active=1 ORDER BY name").all(rid);
  const rows=cats.map(c=>[Markup.button.callback(c.name,"cat:"+c.id)]);
  rows.push([Markup.button.callback("🛍 Все товары раздела","rootproducts:"+rid)]);
  rows.push([Markup.button.callback("⬅️ Назад","catalog:roots")]);
  await ctx.reply("Раздел «"+r.name+"». Выберите категорию:",Markup.inlineKeyboard(rows));
});
bot.action(/^rootproducts:(\d+)$/,async ctx=>{await ctx.answerCbQuery();await showRootProducts(ctx,Number(ctx.match[1]));});
bot.action("catalog:roots",async ctx=>{await ctx.answerCbQuery();await roots(ctx);});
bot.action(/^cat:(\d+)$/,async ctx=>{await ctx.answerCbQuery();await showCategoryProducts(ctx,Number(ctx.match[1]));});
bot.action(/^catall:(\d+)$/,async ctx=>{
  await ctx.answerCbQuery();
  const id=Number(ctx.match[1]);
  const ps=db.prepare("SELECT id,name,description,price,stock,category_id FROM products WHERE category_id=? AND active=1 AND stock>0 ORDER BY name").all(id);
  if(!ps.length)return ctx.reply("В этой категории пока нет товаров.");
  for(const p of ps) await sendProductCard(ctx,p);
});
bot.action(/^product:(\d+)$/,async ctx=>{
  await ctx.answerCbQuery();
  const p=db.prepare("SELECT id,name,description,price,stock,category_id FROM products WHERE id=? AND active=1 AND stock>0").get(Number(ctx.match[1]));
  if(!p)return ctx.reply("Товар недоступен или закончился.");
  await sendProductCard(ctx,p);
});
bot.action(/^add:(\d+)$/,async ctx=>{
  await ctx.answerCbQuery();saveUser(ctx);
  const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1 AND stock>0").get(Number(ctx.match[1]));
  if(!p) return ctx.reply("Товар недоступен или закончился.");
  if(Number(p.stock||0)-Number(p.reserved||0)<=0) return ctx.reply("Товара сейчас нет в наличии. Его можно посмотреть, но заказать нельзя.");
  const cart=db.prepare("SELECT qty FROM carts WHERE user_id=? AND product_id=?").get(String(ctx.from.id),p.id);
  if((cart?.qty||0)>=Math.max(0,Number(p.stock||0)-Number(p.reserved||0))) return ctx.reply("Больше нет свободного остатка.");
  db.prepare(`INSERT INTO carts(user_id,product_id,qty) VALUES(?,?,1) ON CONFLICT(user_id,product_id) DO UPDATE SET qty=qty+1`).run(String(ctx.from.id),p.id);
  await ctx.reply("Добавлено в корзину: "+p.name);
});
async function showCart(ctx) {
  saveUser(ctx);
  const items=db.prepare("SELECT c.product_id,c.qty,p.name,p.price,p.stock FROM carts c JOIN products p ON p.id=c.product_id WHERE c.user_id=?").all(String(ctx.from.id));
  if(!items.length) return ctx.reply("Корзина пустая.");
  const total=items.reduce((s,x)=>s+x.qty*x.price,0);
  await ctx.reply("Корзина:\n"+items.map(x=>x.name+" × "+x.qty+" — "+cash(x.qty*x.price)).join("\n")+"\n\nИтого: "+cash(total),Markup.inlineKeyboard([[Markup.button.callback("✅ Оформить заказ","checkout")],[Markup.button.callback("🧹 Очистить корзину","cartclear")]]));
}
bot.action("cartclear",async ctx=>{await ctx.answerCbQuery();db.prepare("DELETE FROM carts WHERE user_id=?").run(String(ctx.from.id));await ctx.reply("Корзина очищена.");});
bot.action("checkout",async ctx=>{
  await ctx.answerCbQuery();
  const items=db.prepare("SELECT c.qty,p.name,p.stock,p.reserved FROM carts c JOIN products p ON p.id=c.product_id WHERE c.user_id=?").all(String(ctx.from.id));
  if(!items.length) return ctx.reply("Корзина пустая.");
  if(items.some(x=>x.qty>Math.max(0,x.stock-x.reserved))) return ctx.reply("Для одного из товаров недостаточно свободного остатка. Проверьте корзину.");
  setState(ctx.from.id,{step:"phone"});await ctx.reply("Введите номер телефона:",cancelKb());
});
bot.on("text",async ctx=>{
  const bs=broadcastStates.get(String(ctx.from.id));
  if(admin(ctx.from.id)&&bs){
    if(bs.awaitingConfirm)return ctx.reply("Сначала подтвердите или отмените текущую рассылку.");
    const text=ctx.message.text.trim(); if(text.startsWith("/"))return;
    bs.pending={type:"text",text};bs.awaitingConfirm=true;
    return ctx.reply("👀 ПРЕДПРОСМОТР РАССЫЛКИ\n\n"+text,Markup.inlineKeyboard([[Markup.button.callback("✅ Подтвердить отправку","bc:confirm")],[Markup.button.callback("❌ Отменить","bc:cancel")]]));
  }
  const s=getState(ctx.from.id);if(!s)return;
  const t=ctx.message.text.trim();if(t.startsWith("/"))return;
  if(s.step==="phone"){if(t.length<5)return ctx.reply("Введите корректный номер телефона.");s.phone=t;s.step="username";return ctx.reply("Введите Telegram-юзернейм покупателя (например, @username).",cancelKb());}
  if(s.step==="username"){
    if(t.length<2)return ctx.reply("Введите юз (например, @username).");
    const uid=String(ctx.from.id);
    const items=db.prepare("SELECT c.product_id,c.qty,p.name,p.price,p.stock,p.reserved FROM carts c JOIN products p ON p.id=c.product_id WHERE c.user_id=?").all(uid);
    if(!items.length){clearState(ctx.from.id);return ctx.reply("Корзина пуста.");}
    if(items.some(x=>x.qty>Math.max(0,x.stock-x.reserved))){clearState(ctx.from.id);return ctx.reply("Свободный остаток изменился. Обновите корзину.");}
    const total=items.reduce((sum,x)=>sum+x.qty*x.price,0);
    let oid;
    try {
      oid=db.transaction(()=>{
        for(const x of items){
          const r=db.prepare("UPDATE products SET reserved=reserved+? WHERE id=? AND active=1 AND stock-reserved>=?").run(x.qty,x.product_id,x.qty);
          if(!r.changes) throw new Error("Недостаточно свободного остатка: "+x.name);
        }
        const res=db.prepare("INSERT INTO orders(user_id,username,customer_name,phone,tg_username,total,final_total) VALUES(?,?,?,?,?,?,?)").run(uid,ctx.from.username||"",ctx.from.first_name||"",s.phone,t,total,total);
        const newId=Number(res.lastInsertRowid);
        const ins=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,qty,unit_price) VALUES(?,?,?,?,?)");
        for(const x of items)ins.run(newId,x.product_id,x.name,x.qty,x.price);
        db.prepare("DELETE FROM carts WHERE user_id=?").run(uid);
        return newId;
      })();
    } catch(e) { clearState(ctx.from.id); return ctx.reply("Не удалось оформить заказ: "+e.message); }
    clearState(ctx.from.id);
    await ctx.reply("Заказ №"+oid+" создан. Сумма: "+cash(total)+". Товар зарезервирован до подтверждения или отмены.",homeKb(ctx.from.id));
    const order=db.prepare("SELECT * FROM orders WHERE id=?").get(oid);
    const msg="🛒 Новый заказ №"+oid+"\nПокупатель: "+esc(ctx.from.first_name||"")+" (@"+esc(ctx.from.username||"нет")+")\nТелефон: "+esc(s.phone)+"\nЮз: "+esc(t)+"\n"+items.map(x=>esc(x.name)+" × "+x.qty+" — "+cash(x.qty*x.price)).join("\n")+"\nИтого: "+cash(total)+"\n\nРезерв создан.";
    for(const aid of ADMIN_IDS)try{await sendOrderAdminMessage(aid,order,msg);}catch(e){console.error("Admin notification failed",aid,e.message);}
    return;
  }
  if(s.step==="category"){
    try{db.prepare("INSERT INTO categories(root_id,name) VALUES(?,?)").run(s.rootId,t);clearState(ctx.from.id);return ctx.reply("Категория создана.",adminKb());}
    catch(e){return ctx.reply("Не удалось создать категорию: возможно, такое название уже есть.");}
  }
  if(s.step==="edit_product_name"){const r=db.prepare("UPDATE products SET name=? WHERE id=? AND active=1").run(t,s.productId);clearState(ctx.from.id);return ctx.reply(r.changes?"Название товара изменено.":"Товар не найден.",adminKb());}
  if(s.step==="edit_product_desc"){const r=db.prepare("UPDATE products SET description=? WHERE id=? AND active=1").run(t==="-"?"":t,s.productId);clearState(ctx.from.id);return ctx.reply(r.changes?"Описание товара изменено.":"Товар не найден.",adminKb());}
  if(s.step==="edit_product_price"){const price=Number(t.replace(",","."));if(!Number.isFinite(price)||price<0)return ctx.reply("Введите корректную цену.");const r=db.prepare("UPDATE products SET price=? WHERE id=? AND active=1").run(price,s.productId);clearState(ctx.from.id);return ctx.reply(r.changes?"Цена изменена на "+cash(price)+".":"Товар не найден.",adminKb());}
  if(s.step==="edit_category_name"){try{const r=db.prepare("UPDATE categories SET name=? WHERE id=? AND active=1").run(t,s.categoryId);clearState(ctx.from.id);return ctx.reply(r.changes?"Название категории изменено.":"Категория не найдена.",adminKb());}catch(e){return ctx.reply("Не удалось изменить название: такое имя уже есть в разделе.");}}
  if(s.step==="product_name"){s.name=t;s.step="product_desc";return ctx.reply("Описание товара (или - если не нужно).",cancelKb());}
  if(s.step==="product_desc"){s.description=t==="-"?"":t;s.step="product_price";return ctx.reply("Цена продажи в гривнах:",cancelKb());}
  if(s.step==="product_price"){const n=Number(t.replace(",","."));if(!Number.isFinite(n)||n<0)return ctx.reply("Введите корректную цену.");s.price=n;s.step="product_stock";return ctx.reply("Начальный остаток (целое число от 0):",cancelKb());}
  if(s.step==="product_stock"){
    const qty=Number(t);if(!Number.isInteger(qty)||qty<0)return ctx.reply("Введите целое число от 0.");
    const res=db.prepare("INSERT INTO products(category_id,name,description,price,stock) VALUES(?,?,?,?,?)").run(s.catId,s.name,s.description,s.price,qty);
    clearState(ctx.from.id);mediaStates.set(String(ctx.from.id),{productId:Number(res.lastInsertRowid)});
    return ctx.reply("Товар создан. Теперь отправьте любое количество фото/видео по одному. Нажмите «✅ Готово с медиа», когда закончите.",Markup.keyboard([["✅ Готово с медиа"],["❌ Отмена"]]).resize());
  }
  if(s.step==="price"){
    const price=Number(t.replace(",","."));if(!Number.isFinite(price)||price<0)return ctx.reply("Введите корректную цену.");
    db.prepare("UPDATE products SET price=? WHERE id=?").run(price,s.productId);clearState(ctx.from.id);
    return ctx.reply("Цена товара изменена на "+cash(price)+".",adminKb());
  }
  if(s.step==="invoice_qty"){const qty=Number(t);if(!Number.isInteger(qty)||qty<1)return ctx.reply("Введите целое количество больше нуля.");s.qty=qty;s.step="invoice_cost";return ctx.reply("Закупочная цена за единицу, грн:",cancelKb());}
  if(s.step==="invoice_cost"){const cost=Number(t.replace(",","."));if(!Number.isFinite(cost)||cost<0)return ctx.reply("Введите корректную закупочную цену.");db.prepare("INSERT INTO expected_invoice_items(invoice_id,product_id,product_name,qty,unit_cost,unit_price) VALUES(?,?,?,?,?,?)").run(s.invoiceId,s.productId,s.productName,s.qty,cost,s.unitPrice);s.step="invoice_more";return ctx.reply("Позиция добавлена. Что дальше?",Markup.inlineKeyboard([[Markup.button.callback("➕ Добавить ещё товар","a:invmore")],[Markup.button.callback("📥 Сохранить как ожидаемую","a:invsave")],[Markup.button.callback("❌ Отменить накладную","a:invcancel")]]));}
  if(s.step==="stock_qty"){const qty=Number(t);if(!Number.isInteger(qty)||qty<1)return ctx.reply("Введите целое количество больше нуля.");s.qty=qty;s.step="stock_cost";return ctx.reply("Закупочная цена за единицу, грн:",cancelKb());}
  if(s.step==="stock_cost"){const cost=Number(t.replace(",","."));if(!Number.isFinite(cost)||cost<0)return ctx.reply("Введите корректную себестоимость.");s.cost=cost;s.step="stock_payer";return ctx.reply("Кто оплатил? Андрей, Александр или общий.",cancelKb());}
  if(s.step==="stock_payer"){
    const p=db.prepare("SELECT id,name,stock FROM products WHERE id=?").get(s.productId);if(!p){clearState(ctx.from.id);return ctx.reply("Товар не найден.");}
    db.transaction(()=>{db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(s.qty,p.id);db.prepare("INSERT INTO stock_movements(product_id,qty,unit_cost,payer,comment) VALUES(?,?,?,?,?)").run(p.id,s.qty,s.cost,t,"Приход товара");})();
    clearState(ctx.from.id);return ctx.reply("Приход записан. Новый остаток: "+(p.stock+s.qty),adminKb());
  }
  if(s.step==="withdraw_amount"){
    const amount=Number(t.replace(",","."));const a=db.prepare("SELECT balance FROM cash_accounts WHERE admin_id=?").get(s.accountId);
    if(!Number.isFinite(amount)||amount<=0)return ctx.reply("Введите сумму больше нуля.");
    if(!a||amount>a.balance)return ctx.reply("Недостаточно денег на кассе. Баланс: "+cash(a?.balance||0));
    s.amount=amount;s.step="withdraw_comment";return ctx.reply("Обязательно укажите комментарий к снятию.",cancelKb());
  }
  if(s.step==="withdraw_comment"){
    db.transaction(()=>{db.prepare("UPDATE cash_accounts SET balance=balance-? WHERE admin_id=?").run(s.amount,s.accountId);db.prepare("INSERT INTO cash_movements(account_id,actor_id,type,amount,comment) VALUES(?,?,?,?,?)").run(s.accountId,String(ctx.from.id),"withdraw",-s.amount,t);})();
    clearState(ctx.from.id);return ctx.reply("Снятие записано: "+cash(s.amount),adminKb());
  }
  if(s.step==="transfer_amount"){
    const amount=Number(t.replace(",","."));const a=db.prepare("SELECT balance FROM cash_accounts WHERE admin_id=?").get(s.fromId);
    if(!Number.isFinite(amount)||amount<=0)return ctx.reply("Введите сумму больше нуля.");
    if(!a||amount>a.balance)return ctx.reply("Недостаточно денег на кассе.");
    s.amount=amount;s.step="transfer_comment";return ctx.reply("Комментарий к переводу:",cancelKb());
  }
  if(s.step==="transfer_comment"){
    db.transaction(()=>{
      db.prepare("UPDATE cash_accounts SET balance=balance-? WHERE admin_id=?").run(s.amount,s.fromId);
      db.prepare("UPDATE cash_accounts SET balance=balance+? WHERE admin_id=?").run(s.amount,s.toId);
      db.prepare("INSERT INTO cash_movements(account_id,actor_id,type,amount,comment) VALUES(?,?,?,?,?)").run(s.fromId,String(ctx.from.id),"transfer_out",-s.amount,"Кому "+ADMINS[s.toId]+". "+t);
      db.prepare("INSERT INTO cash_movements(account_id,actor_id,type,amount,comment) VALUES(?,?,?,?,?)").run(s.toId,String(ctx.from.id),"transfer_in",s.amount,"От "+ADMINS[s.fromId]+". "+t);
    })();clearState(ctx.from.id);return ctx.reply("Перевод записан в истории.",adminKb());
  }
  if(s.step==="order_total"){
    const total=Number(t.replace(",","."));if(!Number.isFinite(total)||total<0)return ctx.reply("Введите итоговую сумму заказа, не меньше нуля.");
    const o=db.prepare("SELECT id FROM orders WHERE id=? AND status='in_progress' AND assigned_admin=?").get(s.orderId,String(ctx.from.id));if(!o){clearState(ctx.from.id);return ctx.reply("Заказ больше не закреплён за вами или уже обработан.");}
    s.total=total;s.step="order_final";return ctx.reply("Подтвердить заказ №"+s.orderId+" на "+cash(total)+"?",Markup.inlineKeyboard([[Markup.button.callback("Да, подтвердить","finalize:"+s.orderId)],[Markup.button.callback("Отмена","finalcancel")]]));
  }
});

bot.action("a:excel",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;await ctx.reply("Формирую Excel-отчёт за сегодня. Файл также сохранится в папке «Отчёты».");try{const r=await sendDailyExcelReport(ctx.from.id);await ctx.reply("Готово: "+r.filePath);}catch(e){console.error("Excel export error:",e);await ctx.reply("Не удалось создать Excel-отчёт: "+e.message);}});

bot.action("a:broadcast",async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  await ctx.reply("📣 Рассылка. Выберите получателей:",Markup.inlineKeyboard([
    [Markup.button.callback("👥 Всем личным пользователям","bc:users")],
    [Markup.button.callback("💬 Группам и супергруппам","bc:groups")],
    [Markup.button.callback("🌐 Всем пользователям и группам","bc:all")],
    [Markup.button.callback("❌ Закрыть","bc:cancel")]]));
});
bot.action(/^bc:(users|groups|all)$/,async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const mode=ctx.match[1]; broadcastStates.set(String(ctx.from.id),{mode,awaitingConfirm:false,pending:null});
  await ctx.reply("Отправьте текст, фото с подписью или видео с подписью. Сначала появится предпросмотр; рассылка начнётся только после подтверждения.",cancelKb());
});
bot.action("bc:cancel",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;broadcastStates.delete(String(ctx.from.id));clearState(ctx.from.id);await ctx.reply("Рассылка отменена.",adminKb());});
bot.action("bc:confirm",async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const uid=String(ctx.from.id), state=broadcastStates.get(uid);
  if(!state||!state.awaitingConfirm||!state.pending)return ctx.reply("Нет рассылки, ожидающей подтверждения.");
  const content=state.pending; broadcastStates.delete(uid);
  let targets=db.prepare("SELECT chat_id,chat_type FROM chat_targets WHERE active=1").all();
  if(state.mode==="users") targets=targets.filter(x=>x.chat_type==="private");
  if(state.mode==="groups") targets=targets.filter(x=>x.chat_type==="group"||x.chat_type==="supergroup");
  let ok=0,failed=0;
  for(const target of targets){try{
    if(content.type==="photo") await bot.telegram.sendPhoto(target.chat_id,content.file,{caption:content.caption||""});
    else if(content.type==="video") await bot.telegram.sendVideo(target.chat_id,content.file,{caption:content.caption||""});
    else await bot.telegram.sendMessage(target.chat_id,content.text);
    ok++;
  }catch(e){failed++; if(e.response&&e.response.error_code===403)db.prepare("UPDATE chat_targets SET active=0 WHERE chat_id=?").run(target.chat_id);}}
  await ctx.reply("✅ Рассылка завершена.\nПолучателей: "+targets.length+"\nУспешно: "+ok+"\nОшибок: "+failed,adminKb());
});
bot.on(["photo","video"],async ctx=>{
  if(!admin(ctx.from.id))return;
  const media=mediaStates.get(String(ctx.from.id));
  if(media){const isPhoto=Boolean(ctx.message.photo&&ctx.message.photo.length);const file=isPhoto?ctx.message.photo[ctx.message.photo.length-1].file_id:ctx.message.video.file_id;const type=isPhoto?"photo":"video";const pos=db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM product_media WHERE product_id=?").get(media.productId).n;db.prepare("INSERT INTO product_media(product_id,media_type,file_id,position) VALUES(?,?,?,?)").run(media.productId,type,file,pos);return ctx.reply("Медиа добавлено к товару. Отправьте ещё или нажмите «✅ Готово с медиа».");}
  const state=broadcastStates.get(String(ctx.from.id)); if(!state)return;
  if(state.awaitingConfirm)return ctx.reply("Сначала подтвердите или отмените текущую рассылку.");
  const isPhoto=Boolean(ctx.message.photo&&ctx.message.photo.length);
  const file=isPhoto?ctx.message.photo[ctx.message.photo.length-1].file_id:ctx.message.video.file_id;
  const pending={type:isPhoto?"photo":"video",file,caption:ctx.message.caption||""};
  state.pending=pending;state.awaitingConfirm=true;
  if(isPhoto) await ctx.replyWithPhoto(file,{caption:"👀 ПРЕДПРОСМОТР РАССЫЛКИ\n\n"+pending.caption, ...Markup.inlineKeyboard([[Markup.button.callback("✅ Подтвердить отправку","bc:confirm")],[Markup.button.callback("❌ Отменить","bc:cancel")]])});
  else await ctx.replyWithVideo(file,{caption:"👀 ПРЕДПРОСМОТР РАССЫЛКИ\n\n"+pending.caption, ...Markup.inlineKeyboard([[Markup.button.callback("✅ Подтвердить отправку","bc:confirm")],[Markup.button.callback("❌ Отменить","bc:cancel")]])});
});
bot.action("a:cat",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;await ctx.reply("Выберите главный раздел:",Markup.inlineKeyboard(GROUPS.map(n=>[Markup.button.callback(n,"a:catroot:"+rootId(n))])));});
bot.action(/^a:catroot:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"category",rootId:Number(ctx.match[1])});await ctx.reply("Название категории:",cancelKb());});
bot.action("a:product",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const cs=db.prepare("SELECT c.id,c.name,r.name AS root FROM categories c JOIN root_groups r ON r.id=c.root_id WHERE c.active=1 ORDER BY r.id,c.name").all();if(!cs.length)return ctx.reply("Сначала создайте категорию.");await ctx.reply("Выберите категорию:",Markup.inlineKeyboard(cs.map(c=>[Markup.button.callback(c.root+" / "+c.name,"a:prodcat:"+c.id)])));});
bot.action(/^a:prodcat:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"product_name",catId:Number(ctx.match[1])});await ctx.reply("Название товара:",cancelKb());});
bot.action("a:price",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name,price FROM products WHERE active=1 ORDER BY name").all();if(!ps.length)return ctx.reply("Товаров нет.");await ctx.reply("Выберите товар для изменения цены:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name+" — "+cash(p.price),"a:priceprod:"+p.id)])));});
bot.action(/^a:priceprod:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"price",productId:Number(ctx.match[1])});await ctx.reply("Введите новую цену. Цена карточки изменится только после этого действия.",cancelKb());});
bot.action("a:delcat",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const cs=db.prepare("SELECT c.id,c.name,r.name AS root,(SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) AS product_count FROM categories c JOIN root_groups r ON r.id=c.root_id WHERE c.active=1 ORDER BY r.id,c.name").all();if(!cs.length)return ctx.reply("Категорий нет.");await ctx.reply("Выберите категорию для удаления. Товары из неё тоже скроются; история заказов сохранится.",Markup.inlineKeyboard(cs.map(c=>[Markup.button.callback(c.root+" / "+c.name+" ("+c.product_count+" тов.)","a:delcat:"+c.id)])));});
bot.action(/^a:delcat:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);const r=db.prepare("UPDATE categories SET active=0 WHERE id=? AND active=1").run(id);db.prepare("UPDATE products SET active=0 WHERE category_id=?").run(id);await ctx.reply(r.changes?"Категория удалена из каталога вместе с товарами. История заказов сохранена.":"Категория не найдена.");});
bot.action("a:editcat",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const cs=db.prepare("SELECT c.id,c.name,r.name AS root FROM categories c JOIN root_groups r ON r.id=c.root_id WHERE c.active=1 ORDER BY r.id,c.name").all();if(!cs.length)return ctx.reply("Категорий нет.");await ctx.reply("Выберите категорию для переименования:",Markup.inlineKeyboard(cs.map(c=>[Markup.button.callback(c.root+" / "+c.name,"a:editcat:"+c.id)])));});
bot.action(/^a:editcat:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);if(!db.prepare("SELECT id FROM categories WHERE id=? AND active=1").get(id))return ctx.reply("Категория не найдена.");setState(ctx.from.id,{step:"edit_category_name",categoryId:id});await ctx.reply("Введите новое название категории:",cancelKb());});
bot.action("a:allproducts",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT p.id,p.name,p.price,p.stock,p.reserved,p.active,c.name AS category,r.name AS root FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN root_groups r ON r.id=c.root_id ORDER BY p.active DESC,r.id,c.name,p.name").all();if(!ps.length)return ctx.reply("Товаров пока нет.");for(const p of ps){await ctx.reply((p.active?"🟢":"⚫️")+" "+p.name+"\nРаздел: "+(p.root||"—")+"\nКатегория: "+(p.category||"без категории / категория удалена")+"\nЦена: "+cash(p.price)+"\nОстаток: "+p.stock+"\nВ резерве: "+(p.reserved||0)+"\nСвободно: "+Math.max(0,p.stock-(p.reserved||0)),Markup.inlineKeyboard([[Markup.button.callback("✏️ Изменить","a:editproduct:"+p.id),Markup.button.callback(p.active?"🗑 Удалить":"♻️ Восстановить","a:allproducttoggle:"+p.id)]]));}});
bot.action(/^a:allproducttoggle:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);const p=db.prepare("SELECT active,category_id FROM products WHERE id=?").get(id);if(!p)return ctx.reply("Товар не найден.");if(p.active){db.prepare("UPDATE products SET active=0 WHERE id=?").run(id);db.prepare("DELETE FROM carts WHERE product_id=?").run(id);return ctx.reply("Товар удалён из каталога.",adminKb());}const c=db.prepare("SELECT active FROM categories WHERE id=?").get(p.category_id);if(!c||!c.active)return ctx.reply("Нельзя восстановить товар: его категория удалена. Сначала восстановите категорию.");db.prepare("UPDATE products SET active=1 WHERE id=?").run(id);return ctx.reply("Товар восстановлен.",adminKb());});
bot.action("a:editproduct",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name,price FROM products WHERE active=1 ORDER BY name").all();if(!ps.length)return ctx.reply("Товаров нет.");await ctx.reply("Выберите товар:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name+" — "+cash(p.price),"a:editproduct:"+p.id)])));});
bot.action(/^a:editproduct:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(id);if(!p)return ctx.reply("Товар не найден.");await ctx.reply("Что изменить у товара «"+p.name+"»?",Markup.inlineKeyboard([[Markup.button.callback("Название","a:editname:"+id)],[Markup.button.callback("Описание","a:editdesc:"+id)],[Markup.button.callback("Цена","a:editprice:"+id)],[Markup.button.callback("Фото/видео","a:editmedia:"+id)]]));});
bot.action(/^a:editname:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"edit_product_name",productId:Number(ctx.match[1])});await ctx.reply("Введите новое название:",cancelKb());});
bot.action(/^a:editdesc:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"edit_product_desc",productId:Number(ctx.match[1])});await ctx.reply("Введите новое описание (или - чтобы очистить):",cancelKb());});
bot.action(/^a:editprice:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"edit_product_price",productId:Number(ctx.match[1])});await ctx.reply("Введите новую цену:",cancelKb());});
bot.action(/^a:editmedia:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);mediaStates.set(String(ctx.from.id),{productId:id});await ctx.reply("Отправляйте фото/видео по одному. «🧹 Очистить медиа» удалит старые вложения; «✅ Готово с медиа» завершит.",Markup.keyboard([["🧹 Очистить медиа"],["✅ Готово с медиа"],["❌ Отмена"]]).resize());});
bot.action("a:delproduct",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name FROM products WHERE active=1 ORDER BY name").all();if(!ps.length)return ctx.reply("Товаров нет.");await ctx.reply("Выберите товар для удаления:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name,"a:delproduct:"+p.id)])));});
bot.action("a:purgeproducts",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name FROM products WHERE active=0 ORDER BY name").all();if(!ps.length)return ctx.reply("Удалённых товаров нет.");await ctx.reply("Выберите удалённый товар для окончательного удаления:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name,"a:purgeproduct:"+p.id)])));});
bot.action(/^a:purgeproduct:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]),p=db.prepare("SELECT name FROM products WHERE id=? AND active=0").get(id);if(!p)return ctx.reply("Товар не найден.");const refs=db.prepare("SELECT (SELECT COUNT(*) FROM order_items WHERE product_id=?) AS orders,(SELECT COUNT(*) FROM stock_movements WHERE product_id=?) AS stock").get(id,id);if(refs.orders||refs.stock)return ctx.reply("Нельзя удалить окончательно: товар связан с историей заказов или поступлений. История сохранена; товар уже скрыт из каталога.");db.transaction(()=>{db.prepare("DELETE FROM product_media WHERE product_id=?").run(id);db.prepare("DELETE FROM carts WHERE product_id=?").run(id);db.prepare("DELETE FROM products WHERE id=? AND active=0").run(id);});await ctx.reply("Товар «"+p.name+"» удалён окончательно.",adminKb());});
bot.action(/^a:delproduct:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);const p=db.prepare("SELECT name FROM products WHERE id=? AND active=1").get(id);if(!p)return ctx.reply("Товар не найден.");await ctx.reply("Удалить «"+p.name+"» из каталога? История заказов сохранится.",Markup.inlineKeyboard([[Markup.button.callback("Да, удалить","a:delproductyes:"+id)],[Markup.button.callback("Отмена","a:delproductno")]]));});
bot.action(/^a:delproductyes:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);db.transaction(()=>{db.prepare("UPDATE products SET active=0 WHERE id=?").run(id);db.prepare("DELETE FROM carts WHERE product_id=?").run(id);})();await ctx.reply("Товар удалён из каталога. История заказов сохранена.",adminKb());});
bot.action("a:delproductno",async ctx=>{await ctx.answerCbQuery();await ctx.reply("Удаление отменено.",adminKb());});

bot.action("a:expected",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const invs=db.prepare("SELECT id,created_at FROM expected_invoices WHERE status='pending' ORDER BY id DESC").all();await ctx.reply("📦 Ожидаемые поставки: "+invs.length,Markup.inlineKeyboard([[Markup.button.callback("➕ Создать накладную","a:invnew")],...invs.map(x=>[Markup.button.callback("Накладная №"+x.id+" · "+x.created_at,"a:invview:"+x.id)]),[Markup.button.callback("📊 Excel ожидаемых","a:expectedexcel")]]));});
bot.action("a:invnew",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(db.prepare("INSERT INTO expected_invoices(status,created_by) VALUES('draft',?)").run(String(ctx.from.id)).lastInsertRowid);const ps=db.prepare("SELECT id,name,price FROM products WHERE active=1 ORDER BY name").all();if(!ps.length){db.prepare("DELETE FROM expected_invoices WHERE id=?").run(id);return ctx.reply("Сначала добавьте товары.");}setState(ctx.from.id,{step:"invoice_product",invoiceId:id});await ctx.reply("Выберите товар:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name+" · продажа "+cash(p.price),"a:invprod:"+p.id)])));});
bot.action(/^a:invprod:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const st=getState(ctx.from.id);if(!st||st.step!=="invoice_product")return ctx.reply("Нет активного черновика накладной.");const p=db.prepare("SELECT id,name,price FROM products WHERE id=? AND active=1").get(Number(ctx.match[1]));if(!p)return ctx.reply("Товар не найден.");Object.assign(st,{productId:p.id,productName:p.name,unitPrice:p.price,step:"invoice_qty"});await ctx.reply("Количество товара «"+p.name+"»:",cancelKb());});
bot.action("a:invmore",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const st=getState(ctx.from.id);if(!st||st.step!=="invoice_more")return ctx.reply("Нет накладной для продолжения.");st.step="invoice_product";const ps=db.prepare("SELECT id,name,price FROM products WHERE active=1 ORDER BY name").all();await ctx.reply("Выберите следующий товар:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name+" · продажа "+cash(p.price),"a:invprod:"+p.id)])));});
bot.action("a:invsave",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const st=getState(ctx.from.id);if(!st||st.step!=="invoice_more")return ctx.reply("Нет накладной для сохранения.");const n=db.prepare("SELECT COUNT(*) AS n FROM expected_invoice_items WHERE invoice_id=?").get(st.invoiceId).n;if(!n)return ctx.reply("Добавьте хотя бы один товар.");db.prepare("UPDATE expected_invoices SET status='pending' WHERE id=? AND status='draft'").run(st.invoiceId);clearState(ctx.from.id);await ctx.reply("Накладная №"+st.invoiceId+" сохранена со статусом «Ожидается». Склад не изменён.",adminKb());});
bot.action("a:invcancel",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const st=getState(ctx.from.id);if(st?.invoiceId)db.prepare("DELETE FROM expected_invoices WHERE id=? AND status='draft'").run(st.invoiceId);clearState(ctx.from.id);await ctx.reply("Черновик отменён.",adminKb());});
bot.action(/^a:invview:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]),inv=db.prepare("SELECT * FROM expected_invoices WHERE id=? AND status='pending'").get(id);if(!inv)return ctx.reply("Ожидаемая накладная не найдена.");const items=db.prepare("SELECT * FROM expected_invoice_items WHERE invoice_id=? ORDER BY id").all(id);const buy=items.reduce((a,x)=>a+x.qty*x.unit_cost,0),sell=items.reduce((a,x)=>a+x.qty*x.unit_price,0);await ctx.reply("📦 Накладная №"+id+" · Ожидается\n"+items.map(x=>x.product_name+" — "+x.qty+" шт. × закупка "+cash(x.unit_cost)+"; продажа "+cash(x.unit_price)).join("\n")+"\nИтого закупка: "+cash(buy)+"\nИтого продажа: "+cash(sell),Markup.inlineKeyboard([[Markup.button.callback("✅ Подтвердить получение","a:invconfirm:"+id)]]));});
bot.action(/^a:invconfirm:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]),inv=db.prepare("SELECT * FROM expected_invoices WHERE id=? AND status='pending'").get(id);if(!inv)return ctx.reply("Накладная уже обработана.");const items=db.prepare("SELECT * FROM expected_invoice_items WHERE invoice_id=?").all(id);db.transaction(()=>{for(const it of items){db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(it.qty,it.product_id);db.prepare("INSERT INTO stock_movements(product_id,qty,unit_cost,payer,comment) VALUES(?,?,?,?,?)").run(it.product_id,it.qty,it.unit_cost,ADMINS[String(ctx.from.id)]||String(ctx.from.id),"Накладная №"+id);}db.prepare("UPDATE expected_invoices SET status='confirmed',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(String(ctx.from.id),id);})();await ctx.reply("Поставка №"+id+" подтверждена. Товары зачислены на склад.",adminKb());});
async function sendExpectedInvoicesExcel(adminId){
  const wb=new ExcelJS.Workbook(); wb.creator="Продаван";
  const invoices=db.prepare("SELECT * FROM expected_invoices WHERE status='pending' ORDER BY id").all();
  const rows=[], totalsByProduct=new Map(); let buy=0,sell=0;
  for(const inv of invoices) for(const it of db.prepare("SELECT * FROM expected_invoice_items WHERE invoice_id=? ORDER BY id").all(inv.id)){
    const qty=Number(it.qty||0), cost=Number(it.unit_cost||0), price=Number(it.unit_price||0);
    const b=qty*cost,v=qty*price; buy+=b; sell+=v;
    const key=String(it.product_id), total=totalsByProduct.get(key)||{Товар:it.product_name,Всего:0,ЗакупочнаяСумма:0};
    total.Всего+=qty; total.ЗакупочнаяСумма+=b; totalsByProduct.set(key,total);
    rows.push({Накладная:inv.id,Создана:inv.created_at,Товар:it.product_name,Количество:qty,ЗакупкаЗаЕд:cost,ПродажаЗаЕд:price,ЗакупкаВсего:b,ПродажаВсего:v});
  }
  addReportSheet(wb,"Сводка",[["Показатель","Показатель",36],["Сумма, грн","Сумма",20]],[{Показатель:"Общая закупочная стоимость",Сумма:buy},{Показатель:"Общая продажная стоимость",Сумма:sell},{Показатель:"Потенциальная прибыль",Сумма:sell-buy}]);
  addReportSheet(wb,"Сводка товаров",[["Товар","Товар",32],["Всего ожидается, шт.","Всего",20],["Средняя закупочная цена, грн","СредняяЗакупка",26],["Общая закупочная стоимость, грн","ЗакупочнаяСумма",28]],
    Array.from(totalsByProduct.values()).map(x=>({Товар:x.Товар,Всего:x.Всего,СредняяЗакупка:x.Всего?x.ЗакупочнаяСумма/x.Всего:0,ЗакупочнаяСумма:x.ЗакупочнаяСумма})));
  addReportSheet(wb,"Позиции",[["Накладная","Накладная",14],["Создана","Создана",22],["Товар","Товар",28],["Количество","Количество",14],["Закупка за ед., грн","ЗакупкаЗаЕд",18],["Продажа за ед., грн","ПродажаЗаЕд",18],["Закупка всего, грн","ЗакупкаВсего",20],["Продажа всего, грн","ПродажаВсего",20]],rows);
  const file=path.join(REPORTS_DIR,"Ожидаемые_поставки_"+kyivDate(new Date())+".xlsx");
  await wb.xlsx.writeFile(file);
  await bot.telegram.sendDocument(String(adminId),Input.fromLocalFile(file,path.basename(file)),{caption:"Ожидаемые поставки. Закупка: "+cash(buy)+"; продажа: "+cash(sell)+"; потенциальная прибыль: "+cash(sell-buy)});
  return file;
}
bot.action("a:expectedexcel",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;try{const file=await sendExpectedInvoicesExcel(ctx.from.id);await ctx.reply("Отчёт сохранён: "+file,adminKb());}catch(e){console.error(e);await ctx.reply("Ошибка Excel: "+e.message);}});

bot.action("a:stock",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name,stock,reserved FROM products WHERE active=1 ORDER BY name").all();if(!ps.length)return ctx.reply("Товаров нет.");await ctx.reply("Склад (остаток / резерв / свободно):",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name+" ("+p.stock+" / "+p.reserved+" / "+Math.max(0,p.stock-p.reserved)+")","a:stockprod:"+p.id)])));});
bot.action(/^a:stockprod:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"stock_qty",productId:Number(ctx.match[1])});await ctx.reply("Количество прихода:",cancelKb());});
bot.action("a:cash",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const as=db.prepare("SELECT * FROM cash_accounts ORDER BY admin_name").all();await ctx.reply("Кассы:",Markup.inlineKeyboard(as.map(a=>[Markup.button.callback(a.admin_name+": "+cash(a.balance),"cash:account:"+a.admin_id)]).concat([[Markup.button.callback("🔁 Перевод между кассами","cash:transfer")]])));});
bot.action(/^cash:account:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const a=db.prepare("SELECT * FROM cash_accounts WHERE admin_id=?").get(ctx.match[1]);if(!a)return ctx.reply("Касса не найдена.");await ctx.reply(a.admin_name+": "+cash(a.balance),Markup.inlineKeyboard([[Markup.button.callback("💸 Снять","cash:withdraw:"+a.admin_id)],[Markup.button.callback("🔁 Перевести с этой кассы","cash:from:"+a.admin_id)]]));});
bot.action(/^cash:withdraw:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"withdraw_amount",accountId:ctx.match[1]});await ctx.reply("Сумма снятия:",cancelKb());});
bot.action("cash:transfer",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;await ctx.reply("С какой кассы?",Markup.inlineKeyboard(ADMIN_IDS.map(id=>[Markup.button.callback(ADMINS[id],"cash:from:"+id)])));});
bot.action(/^cash:from:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const from=ctx.match[1];await ctx.reply("На какую кассу перевести?",Markup.inlineKeyboard(ADMIN_IDS.filter(id=>id!==from).map(id=>[Markup.button.callback(ADMINS[id],"cash:to:"+from+":"+id)])));});
bot.action(/^cash:to:(\d+):(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"transfer_amount",fromId:ctx.match[1],toId:ctx.match[2]});await ctx.reply("Сумма перевода:",cancelKb());});
bot.action("a:history",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ms=db.prepare("SELECT m.*,a.admin_name FROM cash_movements m JOIN cash_accounts a ON a.admin_id=m.account_id ORDER BY m.id DESC LIMIT 25").all();if(!ms.length)return ctx.reply("История касс пустая.");await ctx.reply("История касс:\n"+ms.map(m=>"#"+m.id+" "+m.admin_name+" "+m.type+" "+cash(m.amount)+" — "+m.comment+" ("+m.created_at+")").join("\n"));});
bot.action("a:orders",async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const os=db.prepare("SELECT * FROM orders WHERE status IN ('new','in_progress') ORDER BY id DESC LIMIT 30").all();
  if(!os.length)return ctx.reply("Активных заказов нет.");
  for(const o of os){
    const items=db.prepare("SELECT product_name,qty,unit_price FROM order_items WHERE order_id=?").all(o.id);
    const owner=o.assigned_admin?("Ответственный: "+(ADMINS[o.assigned_admin]||"неизвестен")):"Не взят в работу";
    const kb=orderKeyboard(o,ctx.from.id);
    await ctx.reply("Заказ №"+o.id+"\n"+items.map(i=>i.product_name+" × "+i.qty+" — "+cash(i.qty*i.unit_price)).join("\n")+"\nСумма: "+cash(o.total)+"\nТелефон: "+o.phone+"\nЮз: "+o.tg_username+"\n"+owner,kb||{});
  }
});
bot.action(/^order:take:([0-9]+)$/,async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const oid=Number(ctx.match[1]);
  const r=db.prepare("UPDATE orders SET status='in_progress',assigned_admin=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='new' AND (assigned_admin IS NULL OR assigned_admin='')").run(String(ctx.from.id),oid);
  if(!r.changes){
    const o=db.prepare("SELECT * FROM orders WHERE id=?").get(oid);
    return ctx.reply(o?.assigned_admin?"Заказ уже закреплён за "+(ADMINS[o.assigned_admin]||"другим администратором")+".":"Заказ уже обработан.");
  }
  await refreshOrderAdminMessages(oid);
  await ctx.reply("Заказ №"+oid+" закреплён за вами.",adminKb());
});
bot.action(/^order:transfer:([0-9]+)$/,async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const oid=Number(ctx.match[1]), o=db.prepare("SELECT * FROM orders WHERE id=?").get(oid);
  if(!canManageOrder(o,ctx.from.id))return ctx.reply("Управлять этим заказом может только ответственный администратор.");
  const targets=ADMIN_IDS.filter(id=>id!==String(ctx.from.id));
  await ctx.reply("Кому передать заказ №"+oid+"?",Markup.inlineKeyboard(targets.map(id=>[Markup.button.callback(ADMINS[id],"order:transferto:"+oid+":"+id)])));
});
bot.action(/^order:transferto:([0-9]+):([0-9]+)$/,async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const oid=Number(ctx.match[1]), target=String(ctx.match[2]);
  if(!ADMIN_IDS.includes(target))return ctx.reply("Администратор не найден.");
  const o=db.prepare("SELECT * FROM orders WHERE id=?").get(oid);
  if(!canManageOrder(o,ctx.from.id))return ctx.reply("Передать заказ может только ответственный администратор.");
  if(target===String(ctx.from.id))return ctx.reply("Заказ уже закреплён за вами.");
  const r=db.prepare("UPDATE orders SET assigned_admin=?,status='in_progress',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='in_progress' AND assigned_admin=?").run(target,oid,String(ctx.from.id));
  if(!r.changes)return ctx.reply("Не удалось передать заказ: статус изменился.");
  await refreshOrderAdminMessages(oid);
  const updated=db.prepare("SELECT * FROM orders WHERE id=?").get(oid);
  try{await bot.telegram.sendMessage(target,"↪️ Вам передан заказ №"+oid+" от "+ADMINS[String(ctx.from.id)]+". Откройте уведомление о заказе выше; кнопки управления обновлены.");}catch(e){console.error("Не удалось уведомить нового ответственного",e.message);}
  await ctx.reply("Заказ №"+oid+" передан "+ADMINS[target]+".",adminKb());
});
bot.action(/^confirm:([0-9]+)$/,async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const o=db.prepare("SELECT * FROM orders WHERE id=?").get(Number(ctx.match[1]));
  if(!canManageOrder(o,ctx.from.id))return ctx.reply(o?.assigned_admin?"Заказом управляет "+(ADMINS[o.assigned_admin]||"другой администратор")+".":"Сначала возьмите заказ в работу.");
  setState(ctx.from.id,{step:"order_total",orderId:o.id});
  await ctx.reply("Сумма заказа по каталогу: "+cash(o.total)+". Введите финальную сумму для покупателя (без скидки — та же сумма).",cancelKb());
});
bot.action("finalcancel",async ctx=>{await ctx.answerCbQuery();clearState(ctx.from.id);await ctx.reply("Подтверждение отменено.");});
bot.action(/^finalize:([0-9]+)$/,async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const s=getState(ctx.from.id), oid=Number(ctx.match[1]);
  if(!s||s.step!=="order_final"||s.orderId!==oid)return ctx.reply("Подтверждение истекло. Откройте заказ заново.");
  const o=db.prepare("SELECT * FROM orders WHERE id=? AND status='in_progress' AND assigned_admin=?").get(oid,String(ctx.from.id));
  if(!o){clearState(ctx.from.id);return ctx.reply("Заказ больше не закреплён за вами или уже обработан.");}
  const items=db.prepare("SELECT * FROM order_items WHERE order_id=?").all(oid);
  try{
    db.transaction(()=>{
      for(const i of items){
        const p=db.prepare("SELECT stock,reserved FROM products WHERE id=?").get(i.product_id);
        if(!p||p.stock<i.qty||p.reserved<i.qty)throw new Error("Недостаточно товара в резерве: "+i.product_name);
      }
      for(const i of items)db.prepare("UPDATE products SET stock=stock-?,reserved=reserved-? WHERE id=?").run(i.qty,i.qty,i.product_id);
      const changed=db.prepare("UPDATE orders SET status='confirmed',final_total=?,confirming_admin=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='in_progress' AND assigned_admin=?").run(s.total,String(ctx.from.id),oid,String(ctx.from.id));
      if(!changed.changes)throw new Error("Ответственный или статус заказа изменился.");
      db.prepare("UPDATE cash_accounts SET balance=balance+? WHERE admin_id=?").run(s.total,String(ctx.from.id));
      db.prepare("INSERT INTO cash_movements(account_id,actor_id,type,amount,comment,related_order) VALUES(?,?,?,?,?,?)").run(String(ctx.from.id),String(ctx.from.id),"sale",s.total,"Оплата заказа №"+oid,oid);
    })();
  }catch(e){clearState(ctx.from.id);return ctx.reply("Не удалось подтвердить заказ: "+e.message);}
  clearState(ctx.from.id); await refreshOrderAdminMessages(oid);
  await ctx.reply("Заказ №"+oid+" подтверждён. "+cash(s.total)+" зачислено на кассу "+ADMINS[String(ctx.from.id)]+".",adminKb());
  try{await bot.telegram.sendMessage(o.user_id,"Ваш заказ №"+oid+" подтверждён. Итог: "+cash(s.total));}catch(e){}
});
bot.action(/^cancel:([0-9]+)$/,async ctx=>{
  await ctx.answerCbQuery(); if(!admin(ctx.from.id))return;
  const oid=Number(ctx.match[1]), o=db.prepare("SELECT * FROM orders WHERE id=?").get(Number(ctx.match[1]));
  if(!canManageOrder(o,ctx.from.id))return ctx.reply(o?.assigned_admin?"Отменить заказ может только ответственный администратор.":"Сначала возьмите заказ в работу.");
  const items=db.prepare("SELECT product_id,qty FROM order_items WHERE order_id=?").all(oid);
  const ok=db.transaction(()=>{
    const r=db.prepare("UPDATE orders SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='in_progress' AND assigned_admin=?").run(oid,String(ctx.from.id));
    if(!r.changes)return false;
    for(const i of items)db.prepare("UPDATE products SET reserved=MAX(0,reserved-?) WHERE id=?").run(i.qty,i.product_id);
    return true;
  })();
  if(!ok)return ctx.reply("Заказ уже обработан или передан другому администратору.");
  await refreshOrderAdminMessages(oid);
  await ctx.reply("Заказ №"+oid+" отменён. Резерв освобождён; физический остаток не менялся.");
  try{await bot.telegram.sendMessage(o.user_id,"Ваш заказ №"+oid+" отменён.");}catch(e){}
});
async function showOrders(ctx){saveUser(ctx);const os=db.prepare("SELECT id,status,final_total,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10").all(String(ctx.from.id));if(!os.length)return ctx.reply("У вас пока нет заказов.");await ctx.reply("Ваши заказы:\n"+os.map(o=>"№"+o.id+" — "+o.status+" — "+cash(o.final_total)+" — "+o.created_at).join("\n"));}
bot.catch(err=>console.error("Ошибка Telegram:",err));
bot.launch().then(()=>{console.log("Продаван запущен. Локальная база:",path.join(DATA_DIR,"prodivan.sqlite"));console.log("Excel-отчёты: папка",REPORTS_DIR,"; ежедневный запуск в 23:55 Europe/Kyiv");}).catch(err=>{console.error("Не удалось запустить:",err);process.exit(1);});
const reportTimer = setInterval(()=>{scheduledExcelReports().catch(e=>console.error("Планировщик Excel:",e));},15000);
process.once("SIGINT",()=>{clearInterval(reportTimer);bot.stop("SIGINT");});
process.once("SIGTERM",()=>{clearInterval(reportTimer);bot.stop("SIGTERM");});
