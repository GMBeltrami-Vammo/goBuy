"""
Supabase template for mcp_local_tools.py
Replace mcp__2ec501f6-*__execute_sql calls with direct Postgres calls.

Install: pip install psycopg2-binary python-dotenv
"""

import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_active_subscriptions(status: str = "active", cache_ttl: int = 300) -> dict:
    """
    Returns count + breakdown of subscriptions by tier.
    Replaces: mcp__supabase__execute_sql with query like:
      SELECT tier, COUNT(*) FROM subscription WHERE status = 'active' GROUP BY tier

    Token savings: ~1,200 token MCP response -> ~80 token JSON output.
    With caching (TTL 5min): ~30 tokens to read the cached file.
    """
    cache_key = f"active_subscriptions_{status}"
    cached = _cache_get(cache_key, cache_ttl)
    if cached:
        return cached

    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT tier, COUNT(*) AS count
                FROM subscription
                WHERE status = %s
                GROUP BY tier
                ORDER BY count DESC
            """, (status,))
            rows = cur.fetchall()
            result = {
                "status_filter": status,
                "total": sum(r["count"] for r in rows),
                "by_tier": [dict(r) for r in rows],
            }
            return _cache_set(cache_key, result)
    finally:
        conn.close()


def run_sql(query: str, params: tuple = (), cache_ttl: int = 0) -> dict:
    """
    Generic SQL runner with optional caching.
    cache_ttl=0 disables caching (use for mutations or volatile data).

    Example: python mcp_local_tools.py sql "SELECT COUNT(*) FROM bike WHERE active = true"

    Token savings: mcp__supabase__execute_sql returns pg result object with column OIDs,
    format metadata, and all rows as nested arrays (~200 overhead tokens + row data).
    This returns only the row dicts you need.
    """
    import hashlib
    cache_key = None
    if cache_ttl > 0:
        cache_key = "sql_" + hashlib.md5(query.encode()).hexdigest()[:12]
        cached = _cache_get(cache_key, cache_ttl)
        if cached:
            return cached

    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params)
            rows = [dict(r) for r in cur.fetchall()]
            result = {"row_count": len(rows), "rows": rows}
            if cache_key:
                return _cache_set(cache_key, result)
            return result
    finally:
        conn.close()
