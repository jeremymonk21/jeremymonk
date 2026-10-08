"""Small persistent cache for paid / slow API responses (stored in the SQLite DB)."""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from .db import ApiCacheEntry, utcnow


def cache_key(obj: Any) -> str:
    raw = json.dumps(obj, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


class ApiCache:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._sf = session_factory
        self.hits = 0
        self.misses = 0

    def get(self, namespace: str, key_obj: Any, ttl_days: float) -> Any | None:
        key = cache_key(key_obj)
        with self._sf() as s:
            row = s.scalar(
                select(ApiCacheEntry).where(ApiCacheEntry.namespace == namespace, ApiCacheEntry.key == key)
            )
            if row is None or utcnow() - row.created_at > timedelta(days=ttl_days):
                self.misses += 1
                return None
            self.hits += 1
            return json.loads(row.payload)

    def set(self, namespace: str, key_obj: Any, payload: Any) -> None:
        key = cache_key(key_obj)
        with self._sf() as s, s.begin():
            s.execute(
                delete(ApiCacheEntry).where(ApiCacheEntry.namespace == namespace, ApiCacheEntry.key == key)
            )
            s.add(ApiCacheEntry(namespace=namespace, key=key, payload=json.dumps(payload)))

    def purge(self, namespace: str | None = None, older_than_days: float | None = None) -> int:
        with self._sf() as s, s.begin():
            stmt = delete(ApiCacheEntry)
            if namespace:
                stmt = stmt.where(ApiCacheEntry.namespace == namespace)
            if older_than_days is not None:
                stmt = stmt.where(ApiCacheEntry.created_at < utcnow() - timedelta(days=older_than_days))
            return s.execute(stmt).rowcount or 0  # type: ignore[attr-defined]
