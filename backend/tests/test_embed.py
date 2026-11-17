"""tests for the text embedding module"""

import logging

import numpy as np
import pytest

from app.embed import embed, get_model


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    """dot(a,b)/(|a||b|); 0 when either is zero-length"""
    norms = float(np.linalg.norm(a) * np.linalg.norm(b))
    return 0.0 if norms == 0.0 else float(np.dot(a, b) / norms)


def test_embed_empty_list_returns_empty_without_loading_model() -> None:
    """an empty batch returns no vectors and leaves the model cache alone"""
    before = get_model.cache_info()
    assert embed([]) == []
    after = get_model.cache_info()
    assert after.misses == before.misses


def test_embed_one_text_returns_384_float32_vector() -> None:
    """one text gives one float32 vector of 384 dims"""
    vectors = embed(["hello world"])
    assert len(vectors) == 1
    assert vectors[0].dtype == np.float32
    assert vectors[0].shape == (384,)


def test_embed_two_texts_keeps_order_and_finite() -> None:
    """two texts give two finite vectors in input order"""
    vectors = embed(["one", "two"])
    assert len(vectors) == 2
    assert all(bool(np.isfinite(vector).all()) for vector in vectors)
    assert all(vector.shape == (384,) for vector in vectors)
    assert np.allclose(vectors[0], embed(["one"])[0])
    assert np.allclose(vectors[1], embed(["two"])[0])


def test_embed_is_stable_for_the_same_text() -> None:
    """the same text gives the same vector on two calls"""
    first = embed(["sqlite stores every row in one file"])[0]
    second = embed(["sqlite stores every row in one file"])[0]
    assert _cosine(first, second) == pytest.approx(1.0)


def test_unrelated_text_gives_lower_cosine() -> None:
    """a saved note and an unrelated text give cosine below 0.9"""
    note = embed(["sqlite keeps rows on disk and the query planner reads one index"])[0]
    other = embed(["the cat sleeps on the warm roof at noon"])[0]
    assert _cosine(note, other) < 0.9


def test_blank_text_logs_debug_and_returns_vector(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """a blank text logs one debug line and still gives a vector"""
    with caplog.at_level(logging.DEBUG, logger="app.embed"):
        vectors = embed(["   "])
    assert vectors[0].shape == (384,)
    assert "blank texts in batch" in caplog.text
