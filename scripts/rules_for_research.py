import feedparser
import json
import os
import re
import fitz  # PyMuPDF
import requests
from email.utils import parsedate_to_datetime
from datetime import datetime, timedelta
from urllib.parse import quote

os.makedirs("data", exist_ok=True)

KEYWORDS = [
    "Copilot", "AI Code Review", "Pair Programming with AI", "LLM in IDEs",
    "AI Developer Tools", "Developer Productivity AI", "Human-in-the-loop",
    "AI trust", "Education AI", "Responsible AI", "AI Alignment", "Fairness in AI",
    "AI open source", "AI Agents", "AI Assistants", "Autonomous Software Agents",
    "AI in APIs", "Developer Workflows", "Future of work"
]

ARXIV_FEEDS = [
    "http://rss.arxiv.org/rss/cs.AI",
    "http://rss.arxiv.org/rss/cs.CL",
    "http://rss.arxiv.org/rss/cs.LG",
    "http://rss.arxiv.org/rss/stat.ML"
]

def extract_matched_keywords(text):
    text = text.lower()
    return [kw for kw in KEYWORDS if kw.lower() in text]

def extract_pdf_text(pdf_url):
    try:
        response = requests.get(pdf_url)
        response.raise_for_status()
        doc = fitz.open("pdf", response.content)
        text = ""
        for page in doc:
            text += page.get_text()
        return text.strip()
    except Exception as e:
        print(f"❌ Failed to read PDF from {pdf_url}: {e}")
        return ""

def fetch_from_api():
    query = " OR ".join([f'"{kw}"' if " " in kw else kw for kw in KEYWORDS])
    search_query = f"all:({query})"
    base_url = "https://export.arxiv.org/api/query"
    params = f"search_query={quote(search_query)}&start=0&max_results=25&sortBy=submittedDate&sortOrder=descending"
    api_url = f"{base_url}?{params}"
    print(f"🔍 Fetching from arXiv API...")

    feed = feedparser.parse(api_url)
    results = []

    for entry in feed.entries:
        pub_date = datetime.strptime(entry.published, "%Y-%m-%dT%H:%M:%SZ")
        if pub_date < datetime.utcnow() - timedelta(days=30):
            continue

        title = entry.title.strip()
        summary = entry.summary.strip()
        content = (title + " " + summary).lower()
        matched_keywords = extract_matched_keywords(content)
        arxiv_id = entry.id.split("/")[-1]
        pdf_link = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        full_text = extract_pdf_text(pdf_link)

        results.append({
            "title": title,
            "summary": summary,
            "link": entry.link,
            "authors": entry.get("author", "Unknown"),
            "arxiv_id": arxiv_id,
            "pdf_link": pdf_link,
            "pub_date": pub_date.isoformat(),
            "source": "arXiv (API)",
            "matched_keywords": matched_keywords,
            "full_text": full_text
        })

    return results

def fetch_from_rss():
    print("⚠️ API failed — falling back to RSS...")
    results = []
    ONE_MONTH_AGO = datetime.utcnow() - timedelta(days=30)

    def clean_html(text):
        return re.sub(r'<[^>]+>', '', text).replace('\n', ' ').strip()

    def parse_description(raw_description):
        match = re.search(r'arXiv:(\S+)\s+Announce Type:\s*(\S+)\s+Abstract:\s*(.*)', raw_description, re.DOTALL)
        if not match:
            return None, None, clean_html(raw_description)
        arxiv_id, announce_type, abstract = match.groups()
        return arxiv_id, announce_type.lower(), clean_html(abstract)

    for url in ARXIV_FEEDS:
        feed = feedparser.parse(url)
        for entry in feed.entries:
            arxiv_id, announce_type, abstract = parse_description(entry.get("description", ""))

            if announce_type != "new":
                continue

            title = entry.get("title", "").strip()
            link = entry.get("link", "")
            authors = entry.get("dc_creator", "Unknown author(s)")
            pub_date_str = entry.get("published", "")
            pub_date = parsedate_to_datetime(pub_date_str) if pub_date_str else None

            if pub_date and pub_date < ONE_MONTH_AGO:
                continue

            pdf_link = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
            full_text = extract_pdf_text(pdf_link)
            content = (title + " " + abstract).lower()
            matched_keywords = extract_matched_keywords(content)

            results.append({
                "title": title,
                "summary": abstract,
                "link": link,
                "authors": authors,
                "arxiv_id": arxiv_id,
                "announce_type": announce_type,
                "pub_date": pub_date.isoformat() if pub_date else None,
                "source": "arXiv (RSS)",
                "matched_keywords": matched_keywords,
                "pdf_link": pdf_link,
                "full_text": full_text
            })

    return results

# Run fetching logic
results = fetch_from_api()
if not results:
    results = fetch_from_rss()

# Sort and keep top 3
results = sorted(results, key=lambda x: len(x["matched_keywords"]), reverse=True)[:3]

# Save to data/input.json
with open("data/input.json", "w") as f:
    json.dump(results, f, indent=2)

print(f"✅ Saved {len(results)} research articles to data/input.json")
