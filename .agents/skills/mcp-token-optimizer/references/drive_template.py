"""
Google Drive template for mcp_local_tools.py
Replace mcp__688b5633-*__read_file_content / download_file_content calls.

Install: pip install google-api-python-client google-auth python-dotenv
"""

import os
import io
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from dotenv import load_dotenv

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

def _drive_service():
    creds = Credentials.from_service_account_file(
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"], scopes=SCOPES
    )
    return build("drive", "v3", credentials=creds)


def read_file(file_id: str, max_chars: int = 5000, cache_ttl: int = 3600) -> dict:
    """
    Downloads and returns truncated text content of a Drive file.
    Replaces mcp__drive__read_file_content which returns the full raw content
    (can be 10,000+ tokens for large docs). This returns only `max_chars` chars.
    """
    cache_key = f"drive_{file_id}_{max_chars}"
    cached = _cache_get(cache_key, cache_ttl)
    if cached:
        return cached

    service = _drive_service()
    meta = service.files().get(fileId=file_id, fields="name,mimeType,size").execute()

    mime = meta["mimeType"]
    if "google-apps.document" in mime:
        content = service.files().export(
            fileId=file_id, mimeType="text/plain"
        ).execute().decode("utf-8")
    elif "google-apps.spreadsheet" in mime:
        content = service.files().export(
            fileId=file_id, mimeType="text/csv"
        ).execute().decode("utf-8")
    else:
        buf = io.BytesIO()
        MediaIoBaseDownload(buf, service.files().get_media(fileId=file_id)).next_chunk()
        content = buf.getvalue().decode("utf-8", errors="replace")

    truncated = len(content) > max_chars
    result = {
        "file_id": file_id,
        "name": meta["name"],
        "mime_type": mime,
        "chars": min(len(content), max_chars),
        "truncated": truncated,
        "content": content[:max_chars],
    }
    return _cache_set(cache_key, result)


def list_folder(folder_id: str, cache_ttl: int = 3600) -> dict:
    """
    Lists files in a Drive folder (name + id only).
    Replaces mcp__drive__list_recent_files which returns full metadata per file.
    """
    cache_key = f"drive_folder_{folder_id}"
    cached = _cache_get(cache_key, cache_ttl)
    if cached:
        return cached

    service = _drive_service()
    resp = service.files().list(
        q=f"'{folder_id}' in parents and trashed=false",
        fields="files(id,name,mimeType,modifiedTime)",
        pageSize=100,
    ).execute()

    files = resp.get("files", [])
    result = {"folder_id": folder_id, "count": len(files), "files": files}
    return _cache_set(cache_key, result)
