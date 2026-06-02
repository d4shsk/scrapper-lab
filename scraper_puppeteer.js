/**
 * Скрапер преподавателей РГПУ им. А. И. Герцена
 * Метод: Node.js + Puppeteer (автономный скрипт)
 * Источник: https://atlas.herzen.spb.ru/teachers
 *
 * Установка: npm install puppeteer
 * Запуск:    node scraper_puppeteer.js
 *
 * Результат: teachers_puppeteer.csv (ФИО, Почта, Телефон)
 */

const puppeteer = require("puppeteer");
const fs = require("fs");

const BASE_URL = "https://atlas.herzen.spb.ru";
const TOTAL_PAGES = 54;
const OUTPUT_FILE = "teachers_puppeteer.csv";
const DELAY_MS = 800; // задержка между запросами

/**
 * Пауза на заданное количество миллисекунд.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Извлекает список преподавателей (ФИО + URL профиля) с одной страницы.
 *
 * HTML-структура:
 *   <td>
 *     <a href="/teachers/{id}" class="text-blue-600">ФИО</a>
 *   </td>
 *
 * @param {import('puppeteer').Page} page  — объект страницы Puppeteer
 * @param {number} pageNum                 — номер страницы (1–54)
 * @returns {Promise<Array<{name: string, url: string}>>}
 */
async function getTeachersFromPage(page, pageNum) {
  await page.goto(`${BASE_URL}/teachers?page=${pageNum}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  return await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll("td a.text-blue-600[href*='/teachers/']")
    ).map(a => ({
      name: a.textContent.trim(),
      url: a.href,
    }));
  });
}

/**
 * Извлекает почту и телефон со страницы профиля преподавателя.
 *
 * HTML-структура:
 *   <div class="flex items-center text-blue-400 py-1 ...">
 *     <svg><!-- иконка конверта / телефона --></svg>
 *     <h1 class="text-m">email@example.com</h1>
 *   </div>
 *
 * @param {import('puppeteer').Page} page
 * @param {string} profileUrl
 * @returns {Promise<{email: string, phone: string}>}
 */
async function getContactInfo(page, profileUrl) {
  try {
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  } catch (err) {
    console.error(`    [ОШИБКА] ${profileUrl}: ${err.message}`);
    return { email: "", phone: "" };
  }

  return await page.evaluate(() => {
    const contacts = { email: "", phone: "" };
    const h1Elements = document.querySelectorAll("h1.text-m");

    h1Elements.forEach(el => {
      const text = el.textContent.trim();
      // Email содержит @
      if (text.includes("@") && !contacts.email) {
        contacts.email = text;
      }
      // Телефон — только цифры, пробелы, +, -, (, ), .
      else if (/^[\d\s\+\-\(\)\.]+$/.test(text) && text.length > 5 && !contacts.phone) {
        contacts.phone = text;
      }
    });

    return contacts;
  });
}

/**
 * Экранирует строку для CSV (обёртывает в кавычки, удваивает внутренние кавычки).
 * @param {string} value
 * @returns {string}
 */
function escapeCSV(value) {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""')}"`;
}

async function main() {
  console.log("Запуск браузера Chromium...");
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36"
  );

  // Шаг 1: собрать все ссылки на профили
  const allTeachers = [];
  console.log(`\n=== Шаг 1: Сбор списка преподавателей (страницы 1–${TOTAL_PAGES}) ===`);

  for (let p = 1; p <= TOTAL_PAGES; p++) {
    process.stdout.write(`  Страница ${p}/${TOTAL_PAGES}... `);
    const teachers = await getTeachersFromPage(page, p);
    console.log(`найдено: ${teachers.length}`);
    allTeachers.push(...teachers);
    await sleep(DELAY_MS);
  }

  console.log(`\nВсего преподавателей: ${allTeachers.length}`);

  // Шаг 2: собрать контакты с каждой страницы профиля
  const results = [];
  console.log("\n=== Шаг 2: Сбор контактных данных ===");

  for (let i = 0; i < allTeachers.length; i++) {
    const teacher = allTeachers[i];
    console.log(`  [${i + 1}/${allTeachers.length}] ${teacher.name}`);
    const contacts = await getContactInfo(page, teacher.url);
    results.push({
      name: teacher.name,
      email: contacts.email,
      phone: contacts.phone,
    });
    await sleep(DELAY_MS);
  }

  // Шаг 3: сохранить CSV
  console.log(`\n=== Шаг 3: Сохранение в ${OUTPUT_FILE} ===`);

  const BOM = "\uFEFF"; // BOM для корректного открытия в Excel
  const header = "ФИО,Почта,Телефон\n";
  const body = results
    .map(r => [escapeCSV(r.name), escapeCSV(r.email), escapeCSV(r.phone)].join(","))
    .join("\n");

  fs.writeFileSync(OUTPUT_FILE, BOM + header + body, "utf8");

  const filled = results.filter(r => r.email || r.phone).length;
  console.log("\n✅ Готово!");
  console.log(`   Всего записей:      ${results.length}`);
  console.log(`   С контактами:       ${filled}`);
  console.log(`   Файл сохранён:      ${OUTPUT_FILE}`);

  await browser.close();
}

main().catch(err => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
