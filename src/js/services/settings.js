// settings.js — تنها مسیر نوشتن تنظیمات عمومی (Phase 22)
//
// تا Phase 21 صفحه‌ی تنظیمات مستقیماً `put('settings', …)` می‌کرد؛ یعنی قاعده‌ی
// کسب‌وکار (کدام فیلدها، چه بازه‌ای) در لایه‌ی UI بود — خلاف تصمیم Phase 21
// («هیچ منطقی خارج از لایه‌ی سرویس»). و چون کل رکورد را بازنویسی می‌کرد، هر فیلدی
// که صفحه نمی‌شناخت (مثلاً سربرگ برگه‌ی چاپ) با هر ذخیره پاک می‌شد. این سرویس
// اعتبارسنجی می‌کند و با رکورد موجود **ادغام** می‌کند.
import { get, put } from '../db/repo.js';
import { setOriginUser, DEFAULT_USER_NAME } from '../db/db.js';
import { nowIso } from '../utils/date.js';
import { ROUNDING_MODES, DEFAULT_ROUNDING_MODE } from './units.js';

export const SETTINGS_ID = 'main';

/** (Phase 27) نام پیش‌فرض کاربر محلی — صفحه‌ها از اینجا می‌خوانند، نه از db/db.js. */
export { DEFAULT_USER_NAME };

export class SettingsValidationError extends Error {
  constructor(fieldErrors) {
    super('تنظیمات واردشده نامعتبر است.');
    this.name = 'SettingsValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export async function getSettings() {
  return (await get('settings', SETTINGS_ID)) || { id: SETTINGS_ID };
}

/**
 * (Phase 27) رکورد تنظیمات یا null اگر هنوز ذخیره نشده — صفحه‌ی تنظیمات در این حالت پیش‌فرض‌های
 * فرم را نشان می‌دهد. جایگزین `repo.get('settings', …)` مستقیم در صفحه‌ها (گارد معماری).
 */
export async function findSettings() {
  return (await get('settings', SETTINGS_ID)) || null;
}

/**
 * ذخیره‌ی بخش «تنظیمات عمومی». فیلدهای ناشناخته‌ی رکورد موجود حفظ می‌شوند.
 * گام وزن (roundWeightStep/roundWeightMode) از Phase 22 وجود ندارد و حذف می‌شود.
 */
export async function saveGeneralSettings(input = {}) {
  const errors = {};
  const n = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const roundToRials = n(input.roundToRials);
  const dueDays = n(input.dueDateAlertDaysAhead);
  const backupDays = n(input.backupReminderDays);
  const mode = input.gramsRoundingMode ?? DEFAULT_ROUNDING_MODE;
  const userName = String(input.userName ?? '').trim();

  if (!(roundToRials >= 0)) errors.roundToRials = 'گام گرد کردن ریال باید صفر یا بیشتر باشد.';
  if (!(dueDays >= 0 && dueDays <= 90)) errors.dueDateAlertDaysAhead = 'بین ۰ تا ۹۰ روز.';
  if (!(backupDays >= 0)) errors.backupReminderDays = 'صفر یا بیشتر.';
  if (!ROUNDING_MODES.includes(mode)) errors.gramsRoundingMode = 'حالت گرد کردن نامعتبر است.';
  if (userName.length > 40) errors.userName = 'نام کاربر حداکثر ۴۰ نویسه است.';
  if (!['en', 'fa'].includes(input.numberFormat ?? 'en')) errors.numberFormat = 'قالب اعداد نامعتبر است.';
  if (Object.keys(errors).length) throw new SettingsValidationError(errors);

  const current = await getSettings();
  const { roundWeightStep, roundWeightMode, ...rest } = current;
  void roundWeightStep;
  void roundWeightMode;
  const saved = {
    ...rest,
    id: SETTINGS_ID,
    numberFormat: input.numberFormat ?? current.numberFormat ?? 'en',
    roundToRials,
    gramsRoundingMode: mode,
    userName: userName || DEFAULT_USER_NAME,
    dueDateAlertDaysAhead: dueDays,
    backupReminderDays: backupDays,
    updatedAt: nowIso(),
  };
  await put('settings', saved);
  setOriginUser(saved.userName);
  return saved;
}
