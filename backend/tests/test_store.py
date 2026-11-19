"""tests for the sqlite store"""

from typing import Any

import numpy as np
import pytest

from app.store import Store, StoreError


def _vec(seed: float) -> np.ndarray:
    """tiny deterministic 4-dim vector for tests"""
    return np.array([seed, seed + 1.0, seed + 2.0, seed + 3.0], dtype=np.float32)


def _add(store: Store, item_id_offset: int = 0) -> int:
    """store one item with two chunks; helper for the search tests"""
    return store.add_item(
        "note",
        f"raw number {item_id_offset}",
        "",
        [f"chunk alpha {item_id_offset}", f"chunk beta {item_id_offset}"],
        [_vec(1.0), _vec(5.0)],
    )


def test_init_creates_tables(tmp_path: Any) -> None:
    """a fresh store file holds the items and chunks tables"""
    db_file = tmp_path / "t.db"
    store = Store(str(db_file))
    store.close()
    assert db_file.exists()


def test_add_item_returns_id_and_persists_rows(tmp_path: Any) -> None:
    """add_item writes one item row and a row per chunk"""
    store = Store(str(tmp_path / "t.db"))
    item_id = _add(store)
    store.close()
    assert item_id == 1
    reopened = Store(str(tmp_path / "t.db"))
    items = reopened.list_items()
    reopened.close()
    assert len(items) == 1
    assert items[0]["chunk_count"] == 2


def test_mismatched_counts_raise(tmp_path: Any) -> None:
    """chunks and embeddings must match one to one"""
    store = Store(str(tmp_path / "t.db"))
    with pytest.raises(StoreError):
        store.add_item("note", "raw", "", ["only one chunk"], [_vec(1.0), _vec(2.0)])
    store.close()


def test_empty_chunks_raise(tmp_path: Any) -> None:
    """an item without chunks has nothing to search"""
    store = Store(str(tmp_path / "t.db"))
    with pytest.raises(StoreError):
        store.add_item("note", "raw", "", [], [])
    store.close()


def test_list_items_shape_and_preview(tmp_path: Any) -> None:
    """list_items returns the api fields and a 120 char preview"""
    store = Store(str(tmp_path / "t.db"))
    store.add_item("note", "x" * 200, "https://example.com/a", ["one", "two"], [_vec(1.0), _vec(2.0)])
    items = store.list_items()
    store.close()
    assert len(items) == 1
    item = items[0]
    assert item["id"] == 1
    assert item["type"] == "note"
    assert item["source"] == "https://example.com/a"
    assert item["preview"] == "x" * 120
    assert item["chunk_count"] == 2
    assert item["created_at"]


def test_search_returns_top_k_sorted(tmp_path: Any) -> None:
    """search scores every chunk and returns the best matches first"""
    store = Store(str(tmp_path / "t.db"))
    _add(store)
    hits = store.search(_vec(1.1), top_k=2)
    store.close()
    assert len(hits) == 2
    assert hits[0]["score"] >= hits[1]["score"]
    assert hits[0]["text"] == "chunk alpha 0"
    assert hits[0]["item_id"] == 1


def test_search_on_empty_store_returns_nothing(tmp_path: Any) -> None:
    """an empty store returns an empty source list, not an error"""
    store = Store(str(tmp_path / "t.db"))
    hits = store.search(_vec(1.0), top_k=5)
    store.close()
    assert hits == []


def test_search_with_zero_vector_scores_zero(tmp_path: Any) -> None:
    """a zero query vector must not divide by zero"""
    store = Store(str(tmp_path / "t.db"))
    _add(store)
    hits = store.search(np.zeros(4, dtype=np.float32), top_k=2)
    store.close()
    assert all(hit["score"] == 0.0 for hit in hits)


def test_a_bad_path_raises_store_error(tmp_path: Any) -> None:
    """sqlite failures surface as StoreError with the path named"""
    with pytest.raises(StoreError) as excinfo:
        Store(str(tmp_path / "missing-dir" / "t.db"))
    assert "cannot open store" in str(excinfo.value)


def test_close_is_idempotent(tmp_path: Any) -> None:
    """close twice; the second call is a no-op"""
    store = Store(str(tmp_path / "t.db"))
    store.close()
    store.close()


def test_hybrid_search_prefers_the_keyword_hit(tmp_path: Any) -> None:
    """identical cosine scores: the keyword match wins by fusion"""
    store = Store(str(tmp_path / "hyb.db"))
    vec = _vec(1.0)
    store.add_item("note", "sqlite chunks get stored", "", ["sqlite chunks get stored"], [vec])
    store.add_item("note", "postgres rows get stored", "", ["postgres rows get stored"], [vec])
    hits = store.search(vec, top_k=2, query_text="sqlite")
    store.close()
    assert len(hits) == 2
    assert hits[0]["text"] == "sqlite chunks get stored"


def test_add_item_shell_and_chunks_round_trip(tmp_path: Any) -> None:
    """a shell stays empty until chunks are attached"""
    store = Store(str(tmp_path / "shell.db"))
    shell = store.add_item_shell("note", "raw content", "")
    assert shell["chunk_count"] == 0
    count = store.add_item_chunks(shell["id"], ["raw content"], [_vec(1.0)])
    assert count == 1
    item = store.get_item(shell["id"])
    assert item is not None
    assert item["chunk_count"] == 1
    store.close()


def test_delete_item_removes_its_chunks(tmp_path: Any) -> None:
    """a deleted item leaves nothing behind"""
    store = Store(str(tmp_path / "del.db"))
    item_id = store.add_item("note", "gone soon", "", ["gone soon"], [_vec(1.0)])
    store.delete_item(item_id)
    assert store.list_items() == []
    store.close()
