// schema.js — تعریف اعلانی Object Storeها و Indexها (منطبق بر DATABASE_SCHEMA.md v2)
// این فایل تنها منبع حقیقت ساختار IndexedDB است. تغییر Schema = افزایش DB_VERSION + بروزرسانی این فایل + ثبت در CHANGELOG.md

export const DB_NAME = 'tala-db';
// v2 (Phase 4): افزودن Index یکتای `code` روی `customers` — کد خودکار مشتری باید در سطح
//               پایگاه‌داده یکتا باشد (نه فقط در لایه سرویس). رجوع به DATABASE_SCHEMA.md §3.2.3.
// v3 (Phase 5): همان Index یکتای `code` روی `suppliers`. در Phase 4 فقط به `customers` اضافه شده
//               بود؛ این ناسازگاری در Phase 5 برطرف شد تا هر دو طرف حساب یک سطح تضمین
//               یکپارچگی داشته باشند. رجوع به DATABASE_SCHEMA.md §3.2.4.
// v4 (Phase 7): افزودن Object Store جدید `saleReturns` (سند برگشت از فروش). چرا Store مستقل و
//               نه یک فیلد روی `sales`: برگشت یک **سند مالی مستقل** با تاریخ، شماره و اثر دفتری
//               خودش است و یک فاکتور می‌تواند چند برگشت جزئی داشته باشد. اگر داخل `sales`
//               نگهداری می‌شد، هر جمع/گزارش/شمارش فاکتور در کل برنامه باید آن را استثنا می‌کرد.
//               رجوع به DATABASE_SCHEMA.md §3.16.
// v5 (Phase 9): افزودن Object Store جدید `transfers` (سند انتقال بین حساب‌ها). چرا Store مستقل:
//               انتقال یک **سند** با شماره، تاریخ، وضعیت و قابلیت ابطال است — نه صرفاً دو رکورد
//               دفتر. بدون سند، کاربر نمی‌تواند یک انتقال اشتباه را به‌عنوان یک واحد لغو کند و
//               «گردش صندوق» هم نمی‌تواند نشان دهد این دو رکورد متعلق به یک رویداد واحدند.
//               (`transactions.sourceType` از Phase 1 مقدار `'transfer'` را پیش‌بینی کرده بود.)
//               رجوع به DATABASE_SCHEMA.md §3.17.
// v6 (Phase 10): افزودن Object Store جدید `inventoryDocs` (سند اصلاح موجودی و سند ذوب/تبدیل).
//               چرا Store مستقل: «موجودی مستقیماً قابل ویرایش نیست» (PROJECT INSTRUCTIONS §۲۰) فقط
//               وقتی واقعاً تضمین می‌شود که هر تغییر دستیِ موجودی **یک سند شماره‌دار، تاریخ‌دار و
//               قابل ابطال** باشد؛ نه یک رکورد دفتر بی‌صاحب. بدون سند، کاربر نمی‌تواند یک اصلاح
//               اشتباه را به‌عنوان یک واحد لغو کند و هیچ گزارشی نمی‌تواند بگوید «چه کسی، کی، چرا».
//               رجوع به DATABASE_SCHEMA.md §3.18 و INVENTORY_RULES §۷.
// v7 (Phase 11): افزودن Object Store جدید `allocations` (تخصیص سند تسویه به فاکتور).
//               چرا Store مستقل و نه یک آرایه روی رکورد پرداخت/دریافت: تخصیص از **هر دو سو**
//               پرسیده می‌شود — «این پرداخت بابت کدام فاکتورها بود؟» و «این فاکتور را چه کسانی
//               تسویه کرده‌اند؟». دومی روی مسیر داغ هر فهرست فاکتور است (مانده هر فاکتور از آن
//               مشتق می‌شود) و با آرایه‌ی درون‌سندی نیازمند اسکن کل Store پرداخت‌ها می‌شد.
//               ضمناً طبق تصمیم Phase 11، تخصیص **مستقل از سند** قابل ویرایش است؛ داده‌ای که
//               چرخه‌ی عمر مستقل دارد نباید داخل رکورد سندِ تغییرناپذیر بنشیند.
//               رجوع به DATABASE_SCHEMA.md §3.19 و ACCOUNTING_RULES §8.
// v8 (Phase 15): افزودن Object Store جدید `restorePoints` (نسخه‌ی اضطراری پیش از بازگردانی).
//               چرا Store مستقل و چرا **بیرون از دامنه‌ی Backup**: در حالت Replace تمام Storeهای
//               داده‌ای پاک می‌شوند (تصمیم صریح Phase 15)، از جمله `backupLogs`. اگر نسخه‌ی
//               اضطراری داخل `backupLogs` نگه داشته می‌شد، دقیقاً همان عملیاتی که باید از آن
//               برگشت‌پذیر باشد، تنها راه برگشت را پاک می‌کرد. بنابراین `restorePoints` نه در
//               فایل پشتیبان نوشته می‌شود و نه در Restore پاک می‌شود — تنها Store پروژه با این
//               خاصیت، و همین آن را «تور ایمنی» می‌کند نه بخشی از داده.
//               فقط **یک** نسخه نگه داشته می‌شود (تصمیم Phase 15)؛ نسخه‌ی قبلی هنگام ساخت
//               نسخه‌ی تازه در همان تراکنش حذف می‌شود تا حجم دیتابیس Safari رشد نکند.
//               رجوع به DATABASE_SCHEMA.md §3.20 و ARCHITECTURE.md §12.
// v9 (Phase 19): واحد رسمی مانده = گرم ۷۵۰ (Migration داده‌ای، بدون Store جدید).
// v10 (Phase 22): عیار هزاری و هویت دستگاه.
//               • Migration داده‌ای: عیار ۲۴تایی ⇒ هزاری در کالاها و دفتر طلا، و شناسه‌ی سطل‌های
//                 انبار (`melted:18` ⇒ `melted:750`) در هر دو دفتر. **اسناد تجاری دست نمی‌خورند**
//                 (Snapshot) — خواننده‌ها با «پروفایل واحد» هر سند آن را تفسیر می‌کنند (services/units.js).
//               • Store جدید `deviceInfo`: شناسه‌ی این نصب. مثل `restorePoints` **بیرون از دامنه‌ی
//                 Backup** است؛ وگرنه بازگردانی روی گوشی دیگر هویت گوشی اول را کپی می‌کرد.
//               • پیش از هر Migration داده‌ای، نسخه‌ی کامل داده (پیش از هر تغییر) در `restorePoints`
//                 با `kind: 'preMigration'` نوشته می‌شود — در همان تراکنش ارتقا.
export const DB_VERSION = 10;

/**
 * هر ورودی: { name, keyPath, indexes: [{ name, keyPath, options }] }
 * ترتیب دقیقاً منطبق بر جدول §1 در DATABASE_SCHEMA.md
 */
export const STORES = [
  {
    name: 'products',
    keyPath: 'id',
    indexes: [
      { name: 'code', keyPath: 'code', options: { unique: true } },
      { name: 'type', keyPath: 'type' },
      { name: 'active', keyPath: 'active' },
      { name: 'deletedAt', keyPath: 'deletedAt' },
    ],
  },
  {
    name: 'customers',
    keyPath: 'id',
    indexes: [
      // Phase 4 (DB v2): کد خودکار مشتری «CU-NNNN» — یکتایی در سطح DB تضمین می‌شود.
      { name: 'code', keyPath: 'code', options: { unique: true } },
      { name: 'name', keyPath: 'name' },
      { name: 'phone', keyPath: 'phone' },
      { name: 'deletedAt', keyPath: 'deletedAt' },
    ],
  },
  {
    name: 'suppliers',
    keyPath: 'id',
    indexes: [
      // Phase 5 (DB v3): کد خودکار تأمین‌کننده «SU-NNNN» — همان تضمین یکتایی مشتری.
      { name: 'code', keyPath: 'code', options: { unique: true } },
      { name: 'name', keyPath: 'name' },
      { name: 'phone', keyPath: 'phone' },
      { name: 'deletedAt', keyPath: 'deletedAt' },
    ],
  },
  {
    name: 'accounts',
    keyPath: 'id',
    indexes: [
      { name: 'type', keyPath: 'type' },
      { name: 'deletedAt', keyPath: 'deletedAt' },
    ],
  },
  {
    name: 'purchases',
    keyPath: 'id',
    indexes: [
      { name: 'number', keyPath: 'number', options: { unique: true } },
      { name: 'supplierId', keyPath: 'supplierId' },
      { name: 'date', keyPath: 'date' },
      { name: 'status', keyPath: 'status' },
      { name: 'productIds', keyPath: 'productIds', options: { multiEntry: true } },
    ],
  },
  {
    name: 'sales',
    keyPath: 'id',
    indexes: [
      { name: 'number', keyPath: 'number', options: { unique: true } },
      { name: 'customerId', keyPath: 'customerId' },
      { name: 'date', keyPath: 'date' },
      { name: 'status', keyPath: 'status' },
      { name: 'productIds', keyPath: 'productIds', options: { multiEntry: true } },
    ],
  },
  {
    // Phase 7 (DB v4): سند برگشت از فروش — مستقل از `sales` (دلیل در بالای فایل).
    name: 'saleReturns',
    keyPath: 'id',
    indexes: [
      { name: 'number', keyPath: 'number', options: { unique: true } },
      { name: 'saleId', keyPath: 'saleId' },
      { name: 'customerId', keyPath: 'customerId' },
      { name: 'date', keyPath: 'date' },
      { name: 'status', keyPath: 'status' },
    ],
  },
  {
    // Phase 9 (DB v5): سند انتقال بین حساب‌ها (وجه↔وجه یا طلا↔طلا — هم‌واحد).
    // `from`/`to` همان شکل `accountRef` دفاتر را دارند تا ارجاع‌ها در کل برنامه یکسان بمانند.
    name: 'transfers',
    keyPath: 'id',
    indexes: [
      { name: 'number', keyPath: 'number', options: { unique: true } },
      { name: 'kind', keyPath: 'kind' },
      { name: 'date', keyPath: 'date' },
      { name: 'status', keyPath: 'status' },
      { name: 'fromRef', keyPath: ['from.kind', 'from.id'] },
      { name: 'toRef', keyPath: ['to.kind', 'to.id'] },
    ],
  },
  {
    // Phase 10 (DB v6): سند انبار — «اصلاح موجودی» و «ذوب/تبدیل».
    // `ref`/`toRef` همان شکل `accountRef` دفاتر را دارند تا ارجاع سطل‌ها در کل برنامه یکسان بماند.
    name: 'inventoryDocs',
    keyPath: 'id',
    indexes: [
      { name: 'number', keyPath: 'number', options: { unique: true } },
      { name: 'kind', keyPath: 'kind' },
      { name: 'category', keyPath: 'category' },
      { name: 'date', keyPath: 'date' },
      { name: 'status', keyPath: 'status' },
      { name: 'refId', keyPath: 'refId' },
      { name: 'toRefId', keyPath: 'toRefId' },
    ],
  },
  {
    // Phase 11 (DB v7): تخصیص یک سند تسویه (receipt/payment) به یک فاکتور (sale/purchase).
    // این رکورد **هیچ اثر دفتری ندارد** — اثر مالی قبلاً توسط رکوردهای دفترِ خودِ سند تسویه
    // ثبت شده است. تخصیص فقط می‌گوید آن پول بابت کدام فاکتور بود، و تنها منبع محاسبه‌ی
    // «مانده فاکتور» است: Outstanding = Total − Σ Allocations − برگشت‌ها.
    name: 'allocations',
    keyPath: 'id',
    indexes: [
      { name: 'docId', keyPath: 'docId' },
      { name: 'targetId', keyPath: 'targetId' },
      { name: 'party', keyPath: ['partyType', 'partyId'] },
      { name: 'status', keyPath: 'status' },
      { name: 'date', keyPath: 'date' },
    ],
  },
  {
    name: 'receipts',
    keyPath: 'id',
    indexes: [
      { name: 'number', keyPath: 'number', options: { unique: true } },
      { name: 'party', keyPath: ['partyType', 'partyId'] },
      { name: 'method', keyPath: 'method' },
      { name: 'date', keyPath: 'date' },
      { name: 'relatedDueDateId', keyPath: 'relatedDueDateId' },
    ],
  },
  {
    name: 'payments',
    keyPath: 'id',
    indexes: [
      { name: 'number', keyPath: 'number', options: { unique: true } },
      { name: 'party', keyPath: ['partyType', 'partyId'] },
      { name: 'method', keyPath: 'method' },
      { name: 'date', keyPath: 'date' },
      { name: 'relatedDueDateId', keyPath: 'relatedDueDateId' },
    ],
  },
  {
    name: 'transactions',
    keyPath: 'id',
    indexes: [
      { name: 'type', keyPath: 'type' },
      { name: 'source', keyPath: ['sourceType', 'sourceId'] },
      { name: 'date', keyPath: 'date' },
      { name: 'reversedBy', keyPath: 'reversedBy' },
    ],
  },
  {
    name: 'goldLedger',
    keyPath: 'id',
    indexes: [
      { name: 'transactionId', keyPath: 'transactionId' },
      { name: 'accountRef', keyPath: ['accountRef.kind', 'accountRef.id'] },
      { name: 'goldType', keyPath: 'goldType' },
      { name: 'karat', keyPath: 'karat' },
      { name: 'productId', keyPath: 'productId' },
      { name: 'date', keyPath: 'date' },
      { name: 'reason', keyPath: 'reason' },
    ],
  },
  {
    name: 'moneyLedger',
    keyPath: 'id',
    indexes: [
      { name: 'transactionId', keyPath: 'transactionId' },
      { name: 'accountRef', keyPath: ['accountRef.kind', 'accountRef.id'] },
      { name: 'date', keyPath: 'date' },
      { name: 'reason', keyPath: 'reason' },
    ],
  },
  {
    name: 'dueDates',
    keyPath: 'id',
    indexes: [
      { name: 'party', keyPath: ['partyType', 'partyId'] },
      { name: 'status', keyPath: 'status' },
      { name: 'dueDate', keyPath: 'dueDate' },
      { name: 'source', keyPath: ['sourceType', 'sourceId'] },
    ],
  },
  {
    name: 'settings',
    keyPath: 'id',
    indexes: [],
  },
  {
    name: 'priceRates',
    keyPath: 'id',
    indexes: [
      { name: 'effectiveDate', keyPath: 'effectiveDate' },
    ],
  },
  {
    name: 'auditLog',
    keyPath: 'id',
    indexes: [
      { name: 'entity', keyPath: 'entity' },
      { name: 'entityId', keyPath: 'entityId' },
      { name: 'action', keyPath: 'action' },
      { name: 'timestamp', keyPath: 'timestamp' },
    ],
  },
  {
    // Phase 15 (DB v8): نسخه‌ی اضطراری پیش از هر Restore — عمداً خارج از دامنه‌ی Backup/Restore.
    name: 'restorePoints',
    keyPath: 'id',
    indexes: [
      { name: 'createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    // Phase 22 (DB v10): هویت این نصب (deviceId) — عمداً خارج از دامنه‌ی Backup/Restore.
    name: 'deviceInfo',
    keyPath: 'id',
    indexes: [],
  },
  {
    name: 'backupLogs',
    keyPath: 'id',
    indexes: [
      { name: 'type', keyPath: 'type' },
      { name: 'timestamp', keyPath: 'timestamp' },
    ],
  },
];
