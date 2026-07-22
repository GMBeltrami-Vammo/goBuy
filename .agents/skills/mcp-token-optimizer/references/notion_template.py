"""
Notion template for mcp_local_tools.py
Replace mcp__7a6c4531-*__notion-fetch and notion-search calls.

Install: pip install notion-client python-dotenv
"""

import os
from notion_client import Client
from dotenv import load_dotenv

load_dotenv()

def _notion() -> Client:
    return Client(auth=os.environ["NOTION_TOKEN"])


def fetch_page_text(page_id: str, cache_ttl: int = 3600) -> dict:
    """
    Fetches a Notion page and extracts plain text content only.
    Replaces: mcp__notion__notion-fetch which returns full block tree with
    all metadata (~800–3,000 tokens). This returns only readable text (~50–300 tokens).
    """
    cache_key = f"notion_page_{page_id.replace('-', '')}"
    cached = _cache_get(cache_key, cache_ttl)
    if cached:
        return cached

    client = _notion()
    page = client.pages.retrieve(page_id)
    blocks = client.blocks.children.list(page_id)

    def extract_text(block: dict) -> str:
        btype = block.get("type", "")
        content = block.get(btype, {})
        texts = content.get("rich_text", [])
        return "".join(t.get("plain_text", "") for t in texts)

    lines = []
    for block in blocks["results"]:
        text = extract_text(block)
        if text.strip():
            lines.append(text)

    title = ""
    props = page.get("properties", {})
    for prop in props.values():
        if prop.get("type") == "title":
            title = "".join(t["plain_text"] for t in prop["title"])
            break

    result = {
        "page_id": page_id,
        "title": title,
        "url": page.get("url"),
        "text": "\n".join(lines),
        "word_count": len(" ".join(lines).split()),
    }
    return _cache_set(cache_key, result)


def query_database(database_id: str, filter_prop: str = None,
                   filter_value: str = None, cache_ttl: int = 300) -> dict:
    """
    Queries a Notion database and returns rows as flat dicts (text only).
    Replaces mcp__notion__notion-fetch on database pages.
    """
    cache_key = f"notion_db_{database_id}_{filter_prop}_{filter_value}"
    cached = _cache_get(cache_key, cache_ttl)
    if cached:
        return cached

    client = _notion()
    payload = {}
    if filter_prop and filter_value:
        payload["filter"] = {
            "property": filter_prop,
            "rich_text": {"contains": filter_value},
        }

    resp = client.databases.query(database_id=database_id, **payload)

    def flatten_props(props: dict) -> dict:
        out = {}
        for name, prop in props.items():
            ptype = prop.get("type", "")
            val = prop.get(ptype)
            if ptype in ("title", "rich_text") and isinstance(val, list):
                out[name] = "".join(t["plain_text"] for t in val)
            elif ptype == "select" and val:
                out[name] = val.get("name")
            elif ptype == "multi_select" and val:
                out[name] = [o["name"] for o in val]
            elif ptype in ("number", "checkbox", "url", "email", "phone_number"):
                out[name] = val
            elif ptype == "date" and val:
                out[name] = val.get("start")
            else:
                out[name] = str(val)[:100] if val else None
        return out

    rows = [flatten_props(p["properties"]) for p in resp["results"]]
    result = {"database_id": database_id, "row_count": len(rows), "rows": rows}
    return _cache_set(cache_key, result)
