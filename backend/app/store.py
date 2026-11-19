"""sqlite-backed item and chunk store; cosine search runs in numpy"""

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone

import numpy as np

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    raw TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
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
        self._lock = threading.Lock()
        try:
            # ponytail: one shared connection across the fastapi threadpool; a
            # real write conflict needs a dedicated process or wal mode
            self._conn = sqlite3.connect(db_path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(SCHEMA)
            self._conn.commit()
            self._fts_ok = self._init_fts()
        except sqlite3.Error as exc:
            raise StoreError(f"cannot open store at {db_path}: {exc}") from exc
        logger.info("store opened at %s", db_path)

    def _init_fts(self) -> bool:
        """create the keyword mirror; report when the build lacks fts5"""
        try:
            with self._lock:
                self._conn.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunk_text)"
                )
                self._conn.commit()
                fts_count = self._conn.execute(
                    "SELECT COUNT(*) AS n FROM chunks_fts"
                ).fetchone()["n"]
                chunk_count = self._conn.execute(
                    "SELECT COUNT(*) AS n FROM chunks"
                ).fetchone()["n"]
                if fts_count != chunk_count:
                    self._conn.execute("DELETE FROM chunks_fts")
                    self._conn.execute(
                        "INSERT INTO chunks_fts(rowid, chunk_text) SELECT id, text FROM chunks"
                    )
                    self._conn.commit()
                    logger.info("backfilled the fts mirror with %d chunks", chunk_count)
            return True
        except sqlite3.Error as exc:
            logger.warning(
                "fts5 unavailable (%s); using vector search alone", exc
            )
            return False

    def _fts_chunk_ids(self, query: str, limit: int) -> list[int]:
        """best-effort keyword search; an empty match keeps the vector leg alone"""
        if not self._fts_ok:
            return []
        words = [word for word in query.lower().split() if len(word) > 2]
        if not words:
            return []
        match = " ".join('"' + word.replace('"', "") + '"' for word in words)
        try:
            with self._lock:
                rows = self._conn.execute(
                    "SELECT rowid, bm25(chunks_fts) AS rank FROM chunks_fts"
                    " WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?",
                    (match, limit),
                ).fetchall()
            return [int(row["rowid"]) for row in rows]
        except sqlite3.Error as exc:
            logger.warning(
                "fts match failed (%s); using vector search alone", exc
            )
            return []

    def _insert_fts_rows(self, rows: list[tuple[int, str]]) -> None:
        """mirror one chunks insert into fts; caller holds the lock and the transaction"""
        if not self._fts_ok:
            return
        self._conn.executemany(
            "INSERT INTO chunks_fts(rowid, chunk_text) VALUES (?, ?)", rows
        )

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
        source: str,
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
            with self._lock:
                cursor = self._conn.cursor()
                cursor.execute(
                    "INSERT INTO items (type, raw, source, created_at) VALUES (?, ?, ?, ?)",
                    (item_type, raw, source, created_at),
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
                chunk_ids = self._conn.execute(
                    "SELECT id FROM chunks WHERE item_id = ? ORDER BY chunk_index",
                    (item_id,),
                ).fetchall()
                self._insert_fts_rows(
                    [(int(row["id"]), text) for row, text in zip(chunk_ids, chunk_texts)]
                )
                self._conn.commit()
        except sqlite3.Error as exc:
            self._conn.rollback()
            raise StoreError(f"write failed: {exc}") from exc
        logger.info("item %d stored with %d chunks", item_id, len(rows))
        return item_id

    def add_item_shell(self, item_type: str, raw: str, source: str) -> dict[str, object]:
        """insert the item row without chunks; return the api item dict"""
        created_at = now_iso()
        try:
            with self._lock:
                cursor = self._conn.cursor()
                cursor.execute(
                    "INSERT INTO items (type, raw, source, created_at) VALUES (?, ?, ?, ?)",
                    (item_type, raw, source, created_at),
                )
                item_id = cursor.lastrowid
                assert item_id is not None
                self._conn.commit()
        except sqlite3.Error as exc:
            self._conn.rollback()
            raise StoreError(f"shell write failed: {exc}") from exc
        item = self.get_item(item_id)
        if item is None:
            logger.error("shell %d vanished right after insert", item_id)
            raise StoreError(f"shell {item_id} vanished after insert")
        logger.info("item %d created as an empty shell", item_id)
        return item

    def add_item_chunks(
        self,
        item_id: int,
        chunk_texts: list[str],
        embeddings: list[np.ndarray],
    ) -> int:
        """insert the chunks for a shell created by add_item_shell; return the count"""
        if len(chunk_texts) != len(embeddings):
            raise StoreError("chunk count and embedding count differ")
        if not chunk_texts:
            raise StoreError("an item needs at least one chunk")
        row = self.get_item(item_id)
        if row is None:
            raise StoreError(f"shell item {item_id} does not exist")
        try:
            with self._lock:
                cursor = self._conn.cursor()
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
                chunk_ids = self._conn.execute(
                    "SELECT id FROM chunks WHERE item_id = ? ORDER BY chunk_index",
                    (item_id,),
                ).fetchall()
                self._insert_fts_rows(
                    [(int(row["id"]), text) for row, text in zip(chunk_ids, chunk_texts)]
                )
                self._conn.commit()
        except sqlite3.Error as exc:
            self._conn.rollback()
            raise StoreError(f"chunk write failed for item {item_id}: {exc}") from exc
        logger.info("item %d received %d chunks", item_id, len(rows))
        return len(rows)

    def delete_item(self, item_id: int) -> None:
        """remove an item, its chunks and the keyword mirror; raise when missing"""
        row = self.get_item(item_id)
        if row is None:
            raise StoreError(f"item {item_id} does not exist")
        try:
            with self._lock:
                chunk_ids = self._conn.execute(
                    "SELECT id FROM chunks WHERE item_id = ?", (item_id,)
                ).fetchall()
                if chunk_ids and self._fts_ok:
                    placeholders = ", ".join("?" for _ in chunk_ids)
                    self._conn.execute(
                        f"DELETE FROM chunks_fts WHERE rowid IN ({placeholders})",
                        tuple(int(row["id"]) for row in chunk_ids),
                    )
                self._conn.execute("DELETE FROM chunks WHERE item_id = ?", (item_id,))
                self._conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
                self._conn.commit()
        except sqlite3.Error as exc:
            self._conn.rollback()
            raise StoreError(f"delete failed for item {item_id}: {exc}") from exc
        logger.info("item %d deleted", item_id)

    def _select_items(
        self, where: str = "", params: tuple[object, ...] = ()
    ) -> list[sqlite3.Row]:
        """run the item join with an optional where clause; lock for threadpool safety"""
        sql = (
            "SELECT i.id, i.type, i.raw, i.source, i.created_at,"
            " COUNT(c.id) AS chunk_count"
            " FROM items i LEFT JOIN chunks c ON c.item_id = i.id"
        )
        if where:
            sql += f" WHERE {where}"
        sql += " GROUP BY i.id ORDER BY i.id"
        with self._lock:
            try:
                return self._conn.execute(sql, params).fetchall()
            except sqlite3.Error as exc:
                raise StoreError(f"list failed: {exc}") from exc

    def list_items(self) -> list[dict[str, object]]:
        """return every item with a preview and its chunk count"""
        return [self._item_row(row) for row in self._select_items()]

    @staticmethod
    def _item_row(row: sqlite3.Row) -> dict[str, object]:
        """project one sql row into the api item shape"""
        raw: str = row["raw"]
        return {
            "id": row["id"],
            "type": row["type"],
            "source": row["source"],
            "created_at": row["created_at"],
            "preview": raw[:120],
            "chunk_count": row["chunk_count"],
        }

    def get_item(self, item_id: int) -> dict[str, object] | None:
        """one item with a preview and its chunk count, or none when missing"""
        rows = self._select_items("i.id = ?", (item_id,))
        if not rows:
            logger.warning("item %d not found", item_id)
            return None
        return self._item_row(rows[0])

    def search(
        self, query_vec: np.ndarray, top_k: int, query_text: str = ""
    ) -> list[dict[str, object]]:
        """hybrid search: cosine ranked list fused with the bm25 ranked list"""
        candidates = self._load_embeddings()
        if not candidates:
            logger.warning("search on empty store; returned no sources")
            return []
        matrix = np.vstack([vec for _, _, _, _, vec in candidates])
        scores = self._cosine_row(query_vec, matrix)
        position_by_id = {candidates[position][0]: position for position in range(len(candidates))}

        rrf_k = 60.0
        fused: dict[int, float] = {}
        for rank, position in enumerate(np.argsort(-scores)[: top_k * 4]):
            chunk_id = candidates[position][0]
            fused[chunk_id] = fused.get(chunk_id, 0.0) + 1.0 / (rrf_k + rank + 1)
        if query_text:
            for rank, chunk_id in enumerate(self._fts_chunk_ids(query_text, top_k * 4)):
                if chunk_id in position_by_id:
                    fused[chunk_id] = fused.get(chunk_id, 0.0) + 1.0 / (rrf_k + rank + 1)

        ordered = sorted(fused, key=fused.get, reverse=True)[:top_k]  # type: ignore[arg-type]
        return [
            {
                "item_id": candidates[position_by_id[chunk_id]][1],
                "chunk_index": candidates[position_by_id[chunk_id]][2],
                "text": candidates[position_by_id[chunk_id]][3],
                "score": float(scores[position_by_id[chunk_id]]),
            }
            for chunk_id in ordered
        ]

    def _load_embeddings(self) -> list[tuple[int, int, int, str, np.ndarray]]:
        """read every chunk row off disk; used as the search source"""
        with self._lock:
            try:
                rows = self._conn.execute(
                    "SELECT id, item_id, chunk_index, text, embedding FROM chunks"
                ).fetchall()
            except sqlite3.Error as exc:
                raise StoreError(f"read failed: {exc}") from exc
        return [
            (row["id"], row["item_id"], row["chunk_index"], row["text"], _decode(row["embedding"]))
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
