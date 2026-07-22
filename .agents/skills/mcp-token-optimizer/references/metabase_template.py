"""
Metabase template for mcp_local_tools.py
Replace mcp__0c847df3-*__query / execute_query calls with direct Metabase REST API.

Install: pip install requests python-dotenv

How to get a session token:
  curl -X POST https://metabase.vammo.com/api/session \
    -H "Content-Type: application/json" \
    -d '{"username": "you@vammo.com", "password": "..."}'
  -> {"id": "<SESSION_TOKEN>"}
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

METABASE_URL = os.environ.get("METABASE_URL", "https://metabase.vammo.com")
_session_token = None


def _get_session() -> str:
    global _session_token
    if _session_token:
        return _session_token

    token = os.environ.get("METABASE_SESSION_TOKEN")
    if token:
        _session_token = token
        return token

    user = os.environ.get("METABASE_USER")
    password = os.environ.get("METABASE_PASSWORD")
    if user and password:
        resp = requests.post(
            f"{METABASE_URL}/api/session",
            json={"username": user, "password": password},
            timeout=10,
        )
        resp.raise_for_status()
        _session_token = resp.json()["id"]
        return _session_token

    raise RuntimeError("Set METABASE_SESSION_TOKEN or METABASE_USER+METABASE_PASSWORD in .env")


def _headers() -> dict:
    return {"X-Metabase-Session": _get_session(), "Content-Type": "application/json"}


def run_card(card_id: int, cache_ttl: int = 300) -> dict:
    """
    Runs a saved Metabase card and returns compact row dicts.
    Replaces: mcp__metabase__query with source={type: "card", id: CARD_ID}

    Token savings: MCP returns ~3,000-6,000 tokens (MBQL metadata + result set + viz settings).
    This returns only column names + row dicts: ~100-400 tokens for a typical 20-row result.
    With caching: ~30 tokens to read the cached file.
    """
    cache_key = f"metabase_card_{card_id}"
    cached = _cache_get(cache_key, cache_ttl)
    if cached:
        return cached

    resp = requests.post(
        f"{METABASE_URL}/api/card/{card_id}/query",
        headers=_headers(),
        json={},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    cols = [col["name"] for col in data["data"]["cols"]]
    rows = data["data"]["rows"]
    result = {
        "card_id": card_id,
        "card_url": f"{METABASE_URL}/question/{card_id}",
        "columns": cols,
        "row_count": len(rows),
        "rows": [dict(zip(cols, row)) for row in rows],
    }
    return _cache_set(cache_key, result)


def run_sql(database_id: int, sql: str, cache_ttl: int = 0) -> dict:
    """
    Runs native SQL against a Metabase database connection.
    Use database_id=137 for ClickHouse (Vammo Replicated), 2 for Postgres.
    cache_ttl=0 disables caching.
    """
    import hashlib
    cache_key = None
    if cache_ttl > 0:
        cache_key = f"metabase_sql_{database_id}_{hashlib.md5(sql.encode()).hexdigest()[:12]}"
        cached = _cache_get(cache_key, cache_ttl)
        if cached:
            return cached

    resp = requests.post(
        f"{METABASE_URL}/api/dataset",
        headers=_headers(),
        json={"database": database_id, "native": {"query": sql}, "type": "native"},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()

    cols = [col["name"] for col in data["data"]["cols"]]
    rows = data["data"]["rows"]
    result = {
        "database_id": database_id,
        "columns": cols,
        "row_count": len(rows),
        "rows": [dict(zip(cols, row)) for row in rows],
    }

    if cache_key:
        return _cache_set(cache_key, result)
    return result


# ── Named business functions (Vammo canonical metrics) ───────────────────────

def get_churn_rate(cache_ttl: int = 3600) -> dict:
    """Monthly churn rate — card 22004."""
    return run_card(22004, cache_ttl)


def get_active_bikes(cache_ttl: int = 300) -> dict:
    """Active bike count by model — card 22018."""
    return run_card(22018, cache_ttl)
