import csv
import re
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "https://atlas.herzen.spb.ru"
TOTAL_PAGES = 54
OUTPUT_FILE = "teachers_bs4.csv"
MAX_WORKERS = 10  # кол-во параллельных потоков

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def get_soup(url: str) -> BeautifulSoup | None:
    try:
        response = SESSION.get(url, timeout=15)
        response.raise_for_status()
        return BeautifulSoup(response.text, "lxml")
    except requests.RequestException as e:
        print(f"  [ОШИБКА] {url}: {e}")
        return None


def get_teachers_from_page(page: int) -> list[dict]:
    url = f"{BASE_URL}/teachers?page={page}"
    soup = get_soup(url)
    if soup is None:
        return []

    teachers = []
    links = soup.select("td a.text-blue-600[href*='/teachers/']")
    for link in links:
        name = link.get_text(strip=True)
        href = link.get("href", "")
        profile_url = href if href.startswith("http") else BASE_URL + href
        if name and profile_url:
            teachers.append({"ФИО": name, "Ссылка": profile_url})
    return teachers


def get_contact_info(teacher: dict) -> dict:
    soup = get_soup(teacher["Ссылка"])
    if soup is None:
        return {"ФИО": teacher["ФИО"], "Почта": "", "Телефон": ""}

    email = ""
    phone = ""
    for el in soup.select("h1.text-m"):
        text = el.get_text(strip=True)
        if "@" in text and not email:
            email = text
        elif re.match(r"^[\d\s\+\-\(\)\.]+$", text) and len(text) > 5 and not phone:
            phone = text

    return {"ФИО": teacher["ФИО"], "Почта": email, "Телефон": phone}


def main():
    # Шаг 1: список преподавателей — параллельно по страницам
    print(f"=== Шаг 1: Сбор списка преподавателей (страницы 1–{TOTAL_PAGES}) ===")
    all_teachers = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(get_teachers_from_page, p): p for p in range(1, TOTAL_PAGES + 1)}
        for future in as_completed(futures):
            page = futures[future]
            result = future.result()
            print(f"  Страница {page}: найдено {len(result)}")
            all_teachers.extend(result)

    print(f"\nВсего преподавателей: {len(all_teachers)}")

    # Шаг 2: контакты — параллельно по профилям
    print("\n=== Шаг 2: Сбор контактных данных ===")
    results = [None] * len(all_teachers)
    completed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(get_contact_info, t): i for i, t in enumerate(all_teachers)}
        for future in as_completed(futures):
            idx = futures[future]
            results[idx] = future.result()
            completed += 1
            print(f"  [{completed}/{len(all_teachers)}] {results[idx]['ФИО']}")

    # Шаг 3: сохранение CSV
    print(f"\n=== Шаг 3: Сохранение в {OUTPUT_FILE} ===")
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["ФИО", "Почта", "Телефон"])
        writer.writeheader()
        writer.writerows(results)

    filled = sum(1 for r in results if r["Почта"] or r["Телефон"])
    print(f"\nГотово!")
    print(f"   Всего записей:   {len(results)}")
    print(f"   С контактами:    {filled}")
    print(f"   Файл сохранён:   {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
