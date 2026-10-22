// download.js — تحویل فایل به کاربر و گرفتن فایل از او (Phase 15)
//
// روی iPhone/Safari دانلود مستقیم همیشه رفتار یکسانی ندارد؛ ARCHITECTURE §12
// از همان Phase 1 گفته بود که مسیر جایگزین «Web Share API» لازم است. ترتیب:
//   ۱) اگر مرورگر بتواند فایل را به اشتراک بگذارد (iOS)، برگه‌ی اشتراک باز می‌شود
//      و کاربر می‌تواند آن را در «فایل‌ها»، iCloud یا تلگرام ذخیره کند.
//   ۲) در غیر این صورت، دانلود معمولی با لینک موقت.
// هر دو مسیر در تست شبیه‌سازی می‌شوند؛ خودِ دانلود قابل Assert نیست، ولی انتخاب
// مسیر و نام فایل هست.

export function makeBlob(content, mime) {
  return new Blob([content], { type: mime });
}

async function shareFile(blob, fileName) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof File !== 'function') return false;
  try {
    const file = new File([blob], fileName, { type: blob.type });
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch (err) {
    // کاربر برگه‌ی اشتراک را بست — این خطا نیست و نباید به دانلود دوباره منجر شود.
    if (err && err.name === 'AbortError') return true;
    return false;
  }
}

function anchorDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // آزادسازی با تأخیر: Safari اگر URL بلافاصله باطل شود، دانلود را نیمه‌کاره رها می‌کند.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** فایل را به کاربر می‌دهد و می‌گوید از کدام مسیر (`share` یا `download`). */
export async function deliverFile(content, fileName, mime) {
  const blob = makeBlob(content, mime);
  if (await shareFile(blob, fileName)) return { method: 'share', fileName };
  anchorDownload(blob, fileName);
  return { method: 'download', fileName };
}

/** انتخاب یک فایل متنی از دستگاه؛ اگر کاربر انصراف دهد `null` برمی‌گرداند. */
export function pickTextFile({ accept = 'application/json,.json' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.insetInlineStart = '-9999px';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve({ name: file.name, size: file.size, text: await file.text() });
      } catch {
        resolve(null);
      }
    });
    input.click();
  });
}
