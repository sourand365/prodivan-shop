require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Telegraf, Markup } = require("telegraf");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN || TOKEN === "PASTE_PRODIVAN_BOT_TOKEN_HERE") {
  console.error("Заполните BOT_TOKEN в локальном файле .env");
  process.exit(1);
}
const ADMINS = { "5340322240": "Андрей", "688000422": "Александр" };
const ADMIN_IDS = Object.keys(ADMINS);
const GROUPS = ["Товары", "Аренда", "Комплектующие"];
const DATA_DIR = path.join(__dirname, "data");
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
`);
const categoryCols = db.prepare("PRAGMA table_info(categories)").all().map(c => c.name); if (!categoryCols.includes("active")) db.exec("ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
const productCols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name); if (!productCols.includes("reserved")) db.exec("ALTER TABLE products ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0");
const orderCols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name); if (!orderCols.includes("assigned_admin")) db.exec("ALTER TABLE orders ADD COLUMN assigned_admin TEXT DEFAULT ''");
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
const rootId = name => db.prepare("SELECT id FROM root_groups WHERE name=?").get(name)?.id;
const homeKb = id => Markup.keyboard(admin(id) ? [["🛍 Каталог","🛒 Корзина"],["📦 Мои заказы","🛠 Админ-панель"]] : [["🛍 Каталог","🛒 Корзина"],["📦 Мои заказы"]]).resize();
const adminKb = () => Markup.inlineKeyboard([
  [Markup.button.callback("➕ Категория","a:cat"),Markup.button.callback("➕ Товар","a:product")],
  [Markup.button.callback("✏️ Изменить товар","a:editproduct"),Markup.button.callback("🗑 Удалить товар","a:delproduct")],
  [Markup.button.callback("✏️ Изменить категорию","a:editcat"),Markup.button.callback("🗑 Удалить категорию","a:delcat")],
  [Markup.button.callback("📦 Приход / склад","a:stock"),Markup.button.callback("💵 Кассы","a:cash")],
  [Markup.button.callback("📋 Все товары","a:allproducts")],
  [Markup.button.callback("📜 История касс","a:history"),Markup.button.callback("📋 Заказы","a:orders")],
  [Markup.button.callback("📣 Рассылка","a:broadcast")]
]);
const cancelKb = () => Markup.keyboard([["❌ Отмена"]]).resize();

function saveUser(ctx) {
  const u = ctx.from;
  db.prepare(`INSERT INTO users(user_id,username,first_name) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name`)
    .run(String(u.id),u.username || "",u.first_name || "");
}
async function roots(ctx) {
  const rows = GROUPS.map(n => [Markup.button.callback(n,"root:"+rootId(n))]);
  return ctx.reply("Выберите раздел каталога:",Markup.inlineKeyboard(rows));
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
bot.action(/^rootproducts:(\d+)$/,async ctx=>{await ctx.answerCbQuery();const rid=Number(ctx.match[1]);const rows=db.prepare("SELECT p.id,p.name,p.description,p.price,p.stock FROM products p JOIN categories c ON c.id=p.category_id WHERE c.root_id=? AND c.active=1 AND p.active=1 ORDER BY p.name").all(rid);if(!rows.length)return ctx.reply("В этом разделе пока нет товаров.");for(const p of rows){const media=db.prepare("SELECT media_type,file_id FROM product_media WHERE product_id=? ORDER BY position,id").all(p.id);for(const m of media){try{if(m.media_type==="photo")await ctx.replyWithPhoto(m.file_id);else await ctx.replyWithVideo(m.file_id);}catch(e){}}await ctx.reply("<b>"+esc(p.name)+"</b>\n"+esc(p.description)+"\nЦена: "+cash(p.price)+"\n"+(p.stock>0?"В наличии: "+p.stock:"Товар закончился"),{parse_mode:"HTML",...Markup.inlineKeyboard([[Markup.button.callback("➕ В корзину","add:"+p.id)]])});}});
bot.action("catalog:roots",async ctx=>{await ctx.answerCbQuery();await roots(ctx);});
bot.action(/^cat:(\d+)$/,async ctx=>{
  await ctx.answerCbQuery();
  const id=Number(ctx.match[1]);
  const cat=db.prepare("SELECT name FROM categories WHERE id=? AND active=1").get(id);
  if(!cat) return ctx.reply("Категория не найдена.");
  const ps=db.prepare("SELECT id,name,description,price,stock FROM products WHERE category_id=? AND active=1 ORDER BY name").all(id);
  if(!ps.length) return ctx.reply("В категории «"+cat.name+"» пока нет товаров.");
  for(const p of ps) {
    const media=db.prepare("SELECT media_type,file_id FROM product_media WHERE product_id=? ORDER BY position,id").all(p.id);
    for(const m of media){try{if(m.media_type==="photo")await ctx.replyWithPhoto(m.file_id);else if(m.media_type==="video")await ctx.replyWithVideo(m.file_id);}catch(e){console.error("Не удалось отправить медиа товара:",e.message);}}
    await ctx.reply("<b>"+esc(p.name)+"</b>\n"+esc(p.description)+"\nЦена: "+cash(p.price)+"\n"+(p.stock>0?"В наличии: "+p.stock:"Товар закончился"),{parse_mode:"HTML",...Markup.inlineKeyboard([[Markup.button.callback("➕ В корзину","add:"+p.id)]])});
  }
});
bot.action(/^add:(\d+)$/,async ctx=>{
  await ctx.answerCbQuery();saveUser(ctx);
  const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(ctx.match[1]));
  if(!p) return ctx.reply("Товар недоступен.");
  const cart=db.prepare("SELECT qty FROM carts WHERE user_id=? AND product_id=?").get(String(ctx.from.id),p.id);
  if((cart?.qty||0)>=p.stock) return ctx.reply("Больше нет в наличии.");
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
  const items=db.prepare("SELECT c.qty,p.name,p.stock FROM carts c JOIN products p ON p.id=c.product_id WHERE c.user_id=?").all(String(ctx.from.id));
  if(!items.length) return ctx.reply("Корзина пустая.");
  if(items.some(x=>x.qty>x.stock)) return ctx.reply("Для одного из товаров недостаточно остатка. Проверьте корзину.");
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
    const items=db.prepare("SELECT c.product_id,c.qty,p.name,p.price,p.stock FROM carts c JOIN products p ON p.id=c.product_id WHERE c.user_id=?").all(uid);
    if(!items.length){clearState(ctx.from.id);return ctx.reply("Корзина пуста.");}
    if(items.some(x=>x.qty>x.stock)){clearState(ctx.from.id);return ctx.reply("Остаток изменился. Обновите корзину.");}
    const total=items.reduce((sum,x)=>sum+x.qty*x.price,0);
    const tx=db.transaction(()=>{
      const res=db.prepare("INSERT INTO orders(user_id,username,customer_name,phone,tg_username,total,final_total) VALUES(?,?,?,?,?,?,?)").run(uid,ctx.from.username||"",ctx.from.first_name||"",s.phone,t,total,total);
      const oid=Number(res.lastInsertRowid);
      const ins=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,qty,unit_price) VALUES(?,?,?,?,?)");
      for(const x of items)ins.run(oid,x.product_id,x.name,x.qty,x.price);
      db.prepare("DELETE FROM carts WHERE user_id=?").run(uid);return oid;
    });
    const oid=tx();clearState(ctx.from.id);
    await ctx.reply("Заказ №"+oid+" создан. Сумма: "+cash(total),homeKb(ctx.from.id));
    const msg="🛒 Новый заказ №"+oid+"\nПокупатель: "+esc(ctx.from.first_name||"")+" (@"+esc(ctx.from.username||"нет")+")\nТелефон: "+esc(s.phone)+"\nЮз: "+esc(t)+"\n"+items.map(x=>esc(x.name)+" × "+x.qty+" — "+cash(x.qty*x.price)).join("\n")+"\nИтого: "+cash(total);
    for(const aid of ADMIN_IDS)try{await bot.telegram.sendMessage(aid,msg,{parse_mode:"HTML",...Markup.inlineKeyboard([[Markup.button.callback("✅ Подтвердить","confirm:"+oid),Markup.button.callback("❌ Отменить","cancel:"+oid)],[Markup.button.callback("↪️ Передать заказ","order:transfer:"+oid)]])});}catch(e){console.error("Admin notification failed",aid,e.message);}
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
    const o=db.prepare("SELECT id FROM orders WHERE id=? AND status='new'").get(s.orderId);if(!o){clearState(ctx.from.id);return ctx.reply("Заказ уже обработан.");}
    s.total=total;s.step="order_final";return ctx.reply("Подтвердить заказ №"+s.orderId+" на "+cash(total)+"?",Markup.inlineKeyboard([[Markup.button.callback("Да, подтвердить","finalize:"+s.orderId)],[Markup.button.callback("Отмена","finalcancel")]]));
  }
});

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
bot.action("a:allproducts",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT p.id,p.name,p.price,p.stock,p.active,c.name AS category,r.name AS root FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN root_groups r ON r.id=c.root_id ORDER BY p.active DESC,r.id,c.name,p.name").all();if(!ps.length)return ctx.reply("Товаров пока нет.");for(const p of ps){await ctx.reply((p.active?"🟢":"⚫️")+" "+p.name+"\nРаздел: "+(p.root||"—")+"\nКатегория: "+(p.category||"без категории / категория удалена")+"\nЦена: "+cash(p.price)+"\nОстаток: "+p.stock,Markup.inlineKeyboard([[Markup.button.callback("✏️ Изменить","a:editproduct:"+p.id),Markup.button.callback(p.active?"🗑 Удалить":"♻️ Восстановить","a:allproducttoggle:"+p.id)]]));}});
bot.action(/^a:allproducttoggle:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);const p=db.prepare("SELECT active,category_id FROM products WHERE id=?").get(id);if(!p)return ctx.reply("Товар не найден.");if(p.active){db.prepare("UPDATE products SET active=0 WHERE id=?").run(id);db.prepare("DELETE FROM carts WHERE product_id=?").run(id);return ctx.reply("Товар удалён из каталога.",adminKb());}const c=db.prepare("SELECT active FROM categories WHERE id=?").get(p.category_id);if(!c||!c.active)return ctx.reply("Нельзя восстановить товар: его категория удалена. Сначала восстановите категорию.");db.prepare("UPDATE products SET active=1 WHERE id=?").run(id);return ctx.reply("Товар восстановлен.",adminKb());});
bot.action("a:editproduct",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name,price FROM products WHERE active=1 ORDER BY name").all();if(!ps.length)return ctx.reply("Товаров нет.");await ctx.reply("Выберите товар:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name+" — "+cash(p.price),"a:editproduct:"+p.id)])));});
bot.action(/^a:editproduct:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(id);if(!p)return ctx.reply("Товар не найден.");await ctx.reply("Что изменить у товара «"+p.name+"»?",Markup.inlineKeyboard([[Markup.button.callback("Название","a:editname:"+id)],[Markup.button.callback("Описание","a:editdesc:"+id)],[Markup.button.callback("Цена","a:editprice:"+id)],[Markup.button.callback("Фото/видео","a:editmedia:"+id)]]));});
bot.action(/^a:editname:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"edit_product_name",productId:Number(ctx.match[1])});await ctx.reply("Введите новое название:",cancelKb());});
bot.action(/^a:editdesc:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"edit_product_desc",productId:Number(ctx.match[1])});await ctx.reply("Введите новое описание (или - чтобы очистить):",cancelKb());});
bot.action(/^a:editprice:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"edit_product_price",productId:Number(ctx.match[1])});await ctx.reply("Введите новую цену:",cancelKb());});
bot.action(/^a:editmedia:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);mediaStates.set(String(ctx.from.id),{productId:id});await ctx.reply("Отправляйте фото/видео по одному. «🧹 Очистить медиа» удалит старые вложения; «✅ Готово с медиа» завершит.",Markup.keyboard([["🧹 Очистить медиа"],["✅ Готово с медиа"],["❌ Отмена"]]).resize());});
bot.action("a:delproduct",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name FROM products WHERE active=1 ORDER BY name").all();if(!ps.length)return ctx.reply("Товаров нет.");await ctx.reply("Выберите товар для удаления:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name,"a:delproduct:"+p.id)])));});
bot.action(/^a:delproduct:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);const p=db.prepare("SELECT name FROM products WHERE id=? AND active=1").get(id);if(!p)return ctx.reply("Товар не найден.");await ctx.reply("Удалить «"+p.name+"» из каталога? История заказов сохранится.",Markup.inlineKeyboard([[Markup.button.callback("Да, удалить","a:delproductyes:"+id)],[Markup.button.callback("Отмена","a:delproductno")]]));});
bot.action(/^a:delproductyes:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const id=Number(ctx.match[1]);db.transaction(()=>{db.prepare("UPDATE products SET active=0 WHERE id=?").run(id);db.prepare("DELETE FROM carts WHERE product_id=?").run(id);})();await ctx.reply("Товар удалён из каталога. История заказов сохранена.",adminKb());});
bot.action("a:delproductno",async ctx=>{await ctx.answerCbQuery();await ctx.reply("Удаление отменено.",adminKb());});
bot.action("a:stock",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ps=db.prepare("SELECT id,name,stock FROM products WHERE active=1 ORDER BY name").all();if(!ps.length)return ctx.reply("Товаров нет.");await ctx.reply("Выберите товар для прихода:",Markup.inlineKeyboard(ps.map(p=>[Markup.button.callback(p.name+" (остаток "+p.stock+")","a:stockprod:"+p.id)])));});
bot.action(/^a:stockprod:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"stock_qty",productId:Number(ctx.match[1])});await ctx.reply("Количество прихода:",cancelKb());});
bot.action("a:cash",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const as=db.prepare("SELECT * FROM cash_accounts ORDER BY admin_name").all();await ctx.reply("Кассы:",Markup.inlineKeyboard(as.map(a=>[Markup.button.callback(a.admin_name+": "+cash(a.balance),"cash:account:"+a.admin_id)]).concat([[Markup.button.callback("🔁 Перевод между кассами","cash:transfer")]])));});
bot.action(/^cash:account:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const a=db.prepare("SELECT * FROM cash_accounts WHERE admin_id=?").get(ctx.match[1]);if(!a)return ctx.reply("Касса не найдена.");await ctx.reply(a.admin_name+": "+cash(a.balance),Markup.inlineKeyboard([[Markup.button.callback("💸 Снять","cash:withdraw:"+a.admin_id)],[Markup.button.callback("🔁 Перевести с этой кассы","cash:from:"+a.admin_id)]]));});
bot.action(/^cash:withdraw:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"withdraw_amount",accountId:ctx.match[1]});await ctx.reply("Сумма снятия:",cancelKb());});
bot.action("cash:transfer",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;await ctx.reply("С какой кассы?",Markup.inlineKeyboard(ADMIN_IDS.map(id=>[Markup.button.callback(ADMINS[id],"cash:from:"+id)])));});
bot.action(/^cash:from:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const from=ctx.match[1];await ctx.reply("На какую кассу перевести?",Markup.inlineKeyboard(ADMIN_IDS.filter(id=>id!==from).map(id=>[Markup.button.callback(ADMINS[id],"cash:to:"+from+":"+id)])));});
bot.action(/^cash:to:(\d+):(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;setState(ctx.from.id,{step:"transfer_amount",fromId:ctx.match[1],toId:ctx.match[2]});await ctx.reply("Сумма перевода:",cancelKb());});
bot.action("a:history",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const ms=db.prepare("SELECT m.*,a.admin_name FROM cash_movements m JOIN cash_accounts a ON a.admin_id=m.account_id ORDER BY m.id DESC LIMIT 25").all();if(!ms.length)return ctx.reply("История касс пустая.");await ctx.reply("История касс:\n"+ms.map(m=>"#"+m.id+" "+m.admin_name+" "+m.type+" "+cash(m.amount)+" — "+m.comment+" ("+m.created_at+")").join("\n"));});
bot.action("a:orders",async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const os=db.prepare("SELECT * FROM orders WHERE status='new' ORDER BY id DESC LIMIT 20").all();if(!os.length)return ctx.reply("Новых заказов нет.");for(const o of os){const items=db.prepare("SELECT product_name,qty,unit_price FROM order_items WHERE order_id=?").all(o.id);await ctx.reply("Заказ №"+o.id+"\n"+items.map(i=>i.product_name+" × "+i.qty+" — "+cash(i.qty*i.unit_price)).join("\n")+"\nСумма: "+cash(o.total)+"\nТелефон: "+o.phone+"\nЮз: "+o.tg_username,Markup.inlineKeyboard([[Markup.button.callback("✅ Подтвердить","confirm:"+o.id),Markup.button.callback("❌ Отменить","cancel:"+o.id)],[Markup.button.callback("↪️ Передать заказ","order:transfer:"+o.id)]]));}});
bot.action(/^order:transfer:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const oid=Number(ctx.match[1]);if(!db.prepare("SELECT id FROM orders WHERE id=? AND status='new'").get(oid))return ctx.reply("Заказ уже обработан.");const targets=ADMIN_IDS.filter(id=>id!==String(ctx.from.id));await ctx.reply("Кому передать заказ №"+oid+"?",Markup.inlineKeyboard(targets.map(id=>[Markup.button.callback(ADMINS[id],"order:transferto:"+oid+":"+id)])));});
bot.action(/^order:transferto:(\d+):(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const oid=Number(ctx.match[1]),target=ctx.match[2];if(!ADMIN_IDS.includes(target))return ctx.reply("Администратор не найден.");const o=db.prepare("SELECT * FROM orders WHERE id=? AND status='new'").get(oid);if(!o)return ctx.reply("Заказ уже обработан.");try{await bot.telegram.sendMessage(target,"↪️ Вам передан заказ №"+oid+"\nТелефон: "+o.phone+"\nЮз: "+o.tg_username+"\nСумма: "+cash(o.total),Markup.inlineKeyboard([[Markup.button.callback("✅ Подтвердить","confirm:"+oid),Markup.button.callback("❌ Отменить","cancel:"+oid)]]));}catch(e){return ctx.reply("Не удалось передать заказ: "+e.message);}await ctx.reply("Заказ №"+oid+" передан "+ADMINS[target]+".",adminKb());});
bot.action(/^confirm:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const o=db.prepare("SELECT * FROM orders WHERE id=? AND status='new'").get(Number(ctx.match[1]));if(!o)return ctx.reply("Заказ уже обработан.");setState(ctx.from.id,{step:"order_total",orderId:o.id});await ctx.reply("Сумма заказа по каталогу: "+cash(o.total)+". Введите финальную сумму для покупателя (без скидки — та же сумма).",cancelKb());});
bot.action("finalcancel",async ctx=>{await ctx.answerCbQuery();clearState(ctx.from.id);await ctx.reply("Подтверждение отменено.");});
bot.action(/^finalize:(\d+)$/,async ctx=>{
  await ctx.answerCbQuery();if(!admin(ctx.from.id))return;
  const s=getState(ctx.from.id);const oid=Number(ctx.match[1]);if(!s||s.step!=="order_final"||s.orderId!==oid)return ctx.reply("Подтверждение истекло. Откройте заказ заново.");
  const o=db.prepare("SELECT * FROM orders WHERE id=? AND status='new'").get(oid);if(!o){clearState(ctx.from.id);return ctx.reply("Заказ уже обработан.");}
  const items=db.prepare("SELECT * FROM order_items WHERE order_id=?").all(oid);
  try{db.transaction(()=>{
    for(const i of items){const p=db.prepare("SELECT stock FROM products WHERE id=?").get(i.product_id);if(!p||p.stock<i.qty)throw new Error("Недостаточно остатка: "+i.product_name);}
    for(const i of items)db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(i.qty,i.product_id);
    db.prepare("UPDATE orders SET status='confirmed',final_total=?,confirming_admin=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='new'").run(s.total,String(ctx.from.id),oid);
    db.prepare("UPDATE cash_accounts SET balance=balance+? WHERE admin_id=?").run(s.total,String(ctx.from.id));
    db.prepare("INSERT INTO cash_movements(account_id,actor_id,type,amount,comment,related_order) VALUES(?,?,?,?,?,?)").run(String(ctx.from.id),String(ctx.from.id),"sale",s.total,"Оплата заказа №"+oid,oid);
  })();}catch(e){clearState(ctx.from.id);return ctx.reply("Не удалось подтвердить заказ: "+e.message);}
  clearState(ctx.from.id);await ctx.reply("Заказ №"+oid+" подтверждён. "+cash(s.total)+" зачислено на кассу "+ADMINS[String(ctx.from.id)]+".",adminKb());
  try{await bot.telegram.sendMessage(o.user_id,"Ваш заказ №"+oid+" подтверждён. Итог: "+cash(s.total));}catch(e){}
});
bot.action(/^cancel:(\d+)$/,async ctx=>{await ctx.answerCbQuery();if(!admin(ctx.from.id))return;const oid=Number(ctx.match[1]);const r=db.prepare("UPDATE orders SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='new'").run(oid);if(!r.changes)return ctx.reply("Заказ уже обработан.");await ctx.reply("Заказ №"+oid+" отменён; остаток не менялся.");const o=db.prepare("SELECT user_id FROM orders WHERE id=?").get(oid);try{await bot.telegram.sendMessage(o.user_id,"Ваш заказ №"+oid+" отменён.");}catch(e){}});
async function showOrders(ctx){saveUser(ctx);const os=db.prepare("SELECT id,status,final_total,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10").all(String(ctx.from.id));if(!os.length)return ctx.reply("У вас пока нет заказов.");await ctx.reply("Ваши заказы:\n"+os.map(o=>"№"+o.id+" — "+o.status+" — "+cash(o.final_total)+" — "+o.created_at).join("\n"));}
bot.catch(err=>console.error("Ошибка Telegram:",err));
bot.launch().then(()=>console.log("Продаван запущен. Локальная база:",path.join(DATA_DIR,"prodivan.sqlite"))).catch(err=>{console.error("Не удалось запустить:",err);process.exit(1);});
process.once("SIGINT",()=>bot.stop("SIGINT"));
process.once("SIGTERM",()=>bot.stop("SIGTERM"));
