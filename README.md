# VODU Plugin for Nuvio

> 🇮🇶 يعمل فقط على شبكة الإنترنت العراقية (Earthlink / Korek / Asiacell / ...)

## كيف يعمل

هذا Plugin (Scraper) لتطبيق **Nuvio** يسمح بمشاهدة الأفلام والمسلسلات من موقع **VODU** (`movie.vodu.me`).

الـ Plugin يعمل بهذه الطريقة:
1. Nuvio يعطيه **TMDB ID** للفيلم أو المسلسل
2. يسأل TMDB API عن اسم العنوان
3. يبحث في موقع VODU بالاسم
4. يستخرج روابط الفيديو من الصفحة
5. يرجع الروابط لـ Nuvio

> ⚠️ الـ Plugin ينفّذ **على جهازك مباشرة**، لذلك طلبات VODU تأتي من شبكتك العراقية — لا يحتاج سيرفر خاص.

---

## طريقة التثبيت في Nuvio

### الخطوة 1: استضافة الـ Repository

**الخيار A — GitHub Pages (مجاني وسهل):**
1. أنشئ Repository جديد على GitHub
2. ارفع ملفي `manifest.json` و `vodu.js`
3. فعّل GitHub Pages من Settings → Pages → `main` branch
4. الرابط سيكون: `https://YOUR-USERNAME.github.io/REPO-NAME/`

**الخيار B — محلي على جهازك (للتجربة):**
```bash
# Python 3
cd /path/to/plugin/folder
python3 -m http.server 8080
# الرابط: http://192.168.X.X:8080/
```

### الخطوة 2: إضافة Repository في Nuvio

1. افتح Nuvio → **Settings** → **Plugins**
2. اضغط **Add Repository**
3. أدخل رابط الـ Repository (مثال: `https://your-username.github.io/vodu-plugin/`)
4. اضغط **Add** وانتظر التحميل
5. ستظهر **VODU** في قائمة الـ Scrapers — فعّلها

### الخطوة 3: تأكد من تفعيل Local Scrapers

1. **Settings** → **Developer** أو **Playback**
2. فعّل **Enable Local Scrapers**

---

## هيكل ملفات الـ Repository

```
your-repository/
├── manifest.json   ← يعرّف الـ scraper (الاسم، الإصدار، ...)
└── vodu.js         ← كود الـ scraper نفسه
```

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| لا تظهر نتائج | تأكد أن جهازك على شبكة ISP العراقية |
| خطأ TMDB | تأكد من إعداد TMDB API Key في Nuvio Settings → TMDB |
| الفيديو لا يشتغل | قد يحتاج تسجيل الدخول في VODU — سيُضاف لاحقاً |
| لم يجد الفيلم | جرب البحث اليدوي في موقع VODU للتأكد من وجوده |

---

## الملفات

- `manifest.json` — تعريف الـ repository والـ scraper
- `vodu.js` — كود الـ scraper الكامل
