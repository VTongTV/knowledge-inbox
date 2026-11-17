"""sqlite-backed item and chunk store; cosine search runs in numpy"""

import json
import logging
import sqlite3
from datetime import datetime, timezone

import numpy as np

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    raw TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES items(id)
);
CREATE INDEX IF NOT EXISTS chunks_item_id ON chunks(item_id);
"""


class StoreError(Exception):
    """raise when the database rejects a write or a read"""


def now_iso() -> str:
    """current utc time in iso 8601, second precision"""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _decode(embedding_json: str) -> np.ndarray:
    """turn a stored json vector back into a float32 numpy array"""
    return np.asarray(json.loads(embedding_json), dtype=np.float32)


class Store:
    """owns the sqlite connection and every read/write path"""

    def __init__(self, db_path: str) -> None:
        """open db_path and create the tables when they do not exist"""
        try:
            self._conn = sqlite3.connect(db_path)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(SCHEMA)
            self._conn.commit()
        except sqlite3.Error as exc:
            raise StoreError(f"cannot open store at {db_path}: {exc}") from exc
        logger.info("store opened at %s", db_path)

    def close(self) -> None:
        """close the connection; safe to call twice"""
        if self._conn is not None:
            self._conn.close()
            self._conn = None  # type: ignore[assignment]

    def __enter__(self) -> "Store":
        """keep the store usable as a context manager"""
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        """close on scope exit"""
        self.close()

    def add_item(
        self,
        item_type: str,
        raw: str,
        chunk_texts: list[str],
        embeddings: list[np.ndarray],
    ) -> int:
        """persist one item plus its chunks; return the new item id"""
        if len(chunk_texts) != len(embeddings):
            raise StoreError("chunk count and embedding count differ")
        if not chunk_texts:
            raise StoreError("an item needs at least one chunk")
        created_at = now_iso()
        try:
            cursor = self._conn.cursor()
            cursor.execute(
                "INSERT INTO items (type, raw, created_at) VALUES (?, ?, ?)",
                (item_type, raw, created_at),
            )
            item_id = cursor.lastrowid
            assert item_id is not None
            rows = [
                (
                    item_id,
                    index,
                    text,
                    json.dumps(vec.astype(np.float32).tolist()),
                )
                for index, (text, vec) in enumerate(zip(chunk_texts, embeddings))
            ]
            cursor.executemany(
                "INSERT INTO chunks (item_id, chunk_index, text, embedding)"
                " VALUES (?, ?, ?, ?)",
                rows,
            )
            self._conn.commit()
        except sqlite3.Error as exc:
            self._conn.rollback()
            raise StoreError(f"write failed: {exc}") from exc
        logger.info("item %d stored with %d chunks", item_id, len(rows))
        return item_id

    def list_items(self) -> list[dict[str, object]]:
        """return every item with a preview and its chunk count"""
        try:
            rows = self._conn.execute(
                "SELECT i.id, i.type, i.raw, i.created_at,"
                " COUNT(c.id) AS chunk_count"
                " FROM items i LEFT JOIN chunks c ON c.item_id = i.id"
                " GROUP BY i.id ORDER BY i.id"
            ).fetchall()
        except sqlite3.Error as exc:
            raise StoreError(f"list failed: {exc}") from exc
        return [self._item_row(row) for row in rows]

    @staticmethod
    def _item_row(row: sqlite3.Row) -> dict[str, object]:
        """project one sql row into the api item shape"""
        raw: str = row["raw"]
        return {
            "id": row["id"],
            "type": row["type"],
            "created_at": row["created_at"],
            "preview": raw[:120],
            "chunk_count": row["chunk_count"],
        }

    def search(
        self, query_vec: np.ndarray, top_k: int
    ) -> list[dict[str, object]]:
        """cosine search over all chunks; return the top_k best matches"""
        candidates = self._load_embeddings()
        if not candidates:
            logger.warning("search on empty store; returned no sources")
            return []
        matrix = np.vstack([vec for _, _, _, vec in candidates])
        scores = self._cosine_row(query_vec, matrix)
        order = np.argsort(-scores)[:top_k]
        return [
            {
                "item_id": candidates[position][0],
                "chunk_index": candidates[position][1],
                "text": candidates[position][2],
                "score": float(scores[position]),
            }
            for position in order
        ]

    def _load_embeddings(self) -> list[tuple[int, int, str, np.ndarray]]:
        """read every chunk row off disk; used as the search source"""
        try:
            rows = self._conn.execute(
                "SELECT item_id, chunk_index, text, embedding FROM chunks"
            ).fetchall()
        except sqlite3.Error as exc:
            raise StoreError(f"read failed: {exc}") from exc
        return [
            (row["item_id"], row["chunk_index"], row["text"], _decode(row["embedding"]))
            for row in rows
        ]

    @staticmethod
    def _cosine_row(query_vec: np.ndarray, matrix: np.ndarray) -> np.ndarray:
        """row of cosine scores between query_vec and each matrix row"""
        query_norm = np.linalg.norm(query_vec)
        if query_norm == 0:
            return np.zeros(matrix.shape[0], dtype=np.float32)
        matrix_norms = np.linalg.norm(matrix, axis=1)
        safe_norms = np.where(matrix_norms == 0, 1.0, matrix_norms)
        return (matrix @ query_vec) / (safe_norms * query_norm)
