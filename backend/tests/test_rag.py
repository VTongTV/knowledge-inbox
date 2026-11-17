"""tests for the rag orchestration; fakes keep the network and the llm out"""

import dataclasses
from typing import Any

import httpx
import numpy as np
import pytest

from app.config import Settings, load_settings
from app.rag import (
    LLMError,
    NO_CONTENT_ANSWER,
    _extract_content,
    answer,
    build_messages,
    query_llm,
    retrieve,
)
from app.store import Store


def _settings(**overrides: Any) -> Settings:
    """load real settings, then apply test overrides"""
    return dataclasses.replace(load_settings(), **overrides)


def _vec() -> np.ndarray:
    """the fixed vector the fake embedder returns"""
    return np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)


def _seeded_store(tmp_path: Any) -> Store:
    """a store whose first chunk embeds exactly to _vec()"""
    store = Store(str(tmp_path / "rag.db"))
    store.add_item(
        "note",
        "raw",
        "",
        ["the answer text", "off topic"],
        [_vec(), np.array([0.0, 1.0, 0.0, 0.0], dtype=np.float32)],
    )
    return store


def _llm_ok(messages: list[dict[str, str]], settings: Settings) -> str:
    """a fake llm that cites what it saw in the prompt"""
    return "per [1], the answer text"


class _CountingLlm:
    """fake llm that counts calls so the test proves the llm stayed unused"""

    def __init__(self) -> None:
        """start the counter at zero"""
        self.calls = 0

    def __call__(self, messages: list[dict[str, str]], settings: Settings) -> str:
        """record the call and return a canned answer"""
        self.calls += 1
        return "canned answer"


def test_retrieve_returns_store_hits(tmp_path: Any) -> None:
    """retrieve embeds the question and returns the store search results"""
    store = _seeded_store(tmp_path)
    settings = _settings()
    hits = retrieve("question", store, settings, embed_fn=lambda texts: [_vec()])
    store.close()
    assert len(hits) == 2
    assert hits[0]["text"] == "the answer text"
    assert hits[0]["score"] == pytest.approx(1.0, abs=1e-5)


def test_answer_pairs_the_llm_text_with_sources(tmp_path: Any) -> None:
    """answer returns the llm text and the sources that fed the prompt"""
    store = _seeded_store(tmp_path)
    result = answer(
        "question",
        store,
        _settings(top_k=2),
        embed_fn=lambda texts: [_vec()],
        llm_fn=_llm_ok,
    )
    store.close()
    assert result["answer"] == "per [1], the answer text"
    assert len(result["sources"]) == 2
    assert result["sources"][0]["text"] == "the answer text"


def test_empty_store_skips_the_llm(tmp_path: Any) -> None:
    """no sources means the empty-inbox answer and no llm call"""
    store = Store(str(tmp_path / "rag.db"))
    llm = _CountingLlm()
    result = answer("question", store, _settings(), embed_fn=lambda texts: [_vec()], llm_fn=llm)
    store.close()
    assert result["answer"] == NO_CONTENT_ANSWER
    assert result["sources"] == []
    assert llm.calls == 0


def test_build_messages_numbers_the_sources() -> None:
    """the prompt numbers sources so the model can cite them"""
    sources = [
        {"item_id": 1, "chunk_index": 0, "text": "first", "score": 0.9},
        {"item_id": 1, "chunk_index": 1, "text": "second", "score": 0.8},
    ]
    messages = build_messages("the question", sources)
    assert messages[0]["role"] == "system"
    assert messages[0]["content"]
    assert "[1] first" in messages[1]["content"]
    assert "[2] second" in messages[1]["content"]
    assert "the question" in messages[1]["content"]


def test_query_llm_missing_key_raises() -> None:
    """no api key produces an llm error that names the env var"""
    settings = _settings(llm_api_key="")
    with pytest.raises(LLMError) as excinfo:
        query_llm([{"role": "user", "content": "q"}], settings)
    assert "OPENROUTER_API_KEY" in str(excinfo.value)


def test_query_llm_happy_path(monkeypatch: Any) -> None:
    """a 200 response yields the assistant content text"""
    settings = _settings(llm_api_key="sku-test")

    def handler(request: httpx.Request) -> httpx.Response:
        """return one choice with plain content"""
        assert "Bearer sku-test" == request.headers.get("Authorization")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "the answer"}}]},
        )

    text = query_llm([{"role": "user", "content": "q"}], settings, transport=httpx.MockTransport(handler))
    assert text == "the answer"


def test_query_llm_upstream_failure_raises(monkeypatch: Any) -> None:
    """a non-200 llm response becomes an llm error with the status code"""
    settings = _settings(llm_api_key="sku-test")

    def handler(request: httpx.Request) -> httpx.Response:
        """simulate an upstream rate limit"""
        return httpx.Response(429, text="rate limited")

    with pytest.raises(LLMError) as excinfo:
        query_llm([{"role": "user", "content": "q"}], settings, transport=httpx.MockTransport(handler))
    assert "429" in str(excinfo.value)


def test_query_llm_transport_failure_raises() -> None:
    """a connection failure becomes an llm error, not a raw httpx error"""
    settings = _settings(llm_api_key="sku-test")

    def handler(request: httpx.Request) -> httpx.Response:
        """simulate a dead connection"""
        raise httpx.ConnectError("connection refused")

    with pytest.raises(LLMError) as excinfo:
        query_llm([{"role": "user", "content": "q"}], settings, transport=httpx.MockTransport(handler))
    assert "connection refused" in str(excinfo.value)


def test_extract_content_rejects_empty_choices() -> None:
    """a payload without choices is an unusable answer"""
    with pytest.raises(LLMError):
        _extract_content({"choices": []})
    with pytest.raises(LLMError):
        _extract_content({"choices": [{"message": {"content": "  "}}]})
    with pytest.raises(LLMError):
        _extract_content({"choices": [{"message": None}]})
