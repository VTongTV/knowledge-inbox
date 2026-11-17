"""retrieve chunks, build the prompt, call the llm; one orchestration entry"""

import logging
from typing import Callable

import httpx

from app.config import Settings, load_settings
from app.embed import embed
from app.store import Store

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You answer questions about a personal knowledge inbox. "
    "Use only the numbered context below. Cite each fact as [n] "
    "with the source number. When the context does not cover the "
    "question, say that no saved source covers it."
)

NO_CONTENT_ANSWER = (
    "No content is saved yet. Add a note or a URL first, "
    "then ask the question again."
)


class LLMError(Exception):
    """raise when the llm endpoint fails or its answer is unusable"""


def retrieve(
    question: str,
    store: Store,
    settings: Settings,
    embed_fn: Callable[[list[str]], list] = embed,
) -> list[dict[str, object]]:
    """embed the question and cosine-search the chunk store"""
    vectors = embed_fn([question])
    if not vectors:
        raise LLMError("question embedding returned no vector")
    hits = store.search(vectors[0], settings.top_k)
    logger.info(
        "retrieve: question len=%d, hits=%d", len(question), len(hits)
    )
    return hits


def build_messages(
    question: str, sources: list[dict[str, object]]
) -> list[dict[str, str]]:
    """assemble the chat messages: the system rule, the context, the question"""
    lines = [
        f"[{position}] {source['text']}"
        for position, source in enumerate(sources, start=1)
    ]
    context = "\n".join(lines)
    user_content = f"Context:\n{context}\n\nQuestion: {question}\nAnswer:"
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def query_llm(
    messages: list[dict[str, str]],
    settings: Settings,
    transport: httpx.BaseTransport | None = None,
) -> str:
    """post messages to the openrouter-compatible chat endpoint; return the text"""
    if not settings.llm_api_key:
        raise LLMError(
            "OPENROUTER_API_KEY is not set; put it in backend/.env and restart"
        )
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {settings.llm_api_key}"}
    url = f"{settings.llm_base_url}/chat/completions"
    try:
        with httpx.Client(
            transport=transport, timeout=settings.llm_timeout
        ) as client:
            response = client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise LLMError(f"llm request to {url} failed: {exc}") from exc
    if response.status_code != 200:
        raise LLMError(
            f"llm returned {response.status_code}: {response.text[:200]}"
        )
    return _extract_content(response.json())


def _extract_content(payload: dict[str, object]) -> str:
    """pull the assistant text out of a chat completion response"""
    choices = payload.get("choices")
    if not choices:
        raise LLMError(f"llm answer had no choices: {str(payload)[:200]}")
    first: dict[str, object] = choices[0]
    message = first.get("message")
    if not isinstance(message, dict):
        raise LLMError("llm answer had no message object")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise LLMError("llm answer content was empty")
    return content


def answer(
    question: str,
    store: Store,
    settings: Settings | None = None,
    embed_fn: Callable[[list[str]], list] = embed,
    llm_fn: Callable[[list[dict[str, str]], Settings], str] = query_llm,
) -> dict[str, object]:
    """run the full rag loop; return the answer text and its sources"""
    if settings is None:
        settings = load_settings()
    sources = retrieve(question, store, settings, embed_fn)
    if not sources:
        logger.info("no sources found; returned the empty-inbox answer")
        return {"answer": NO_CONTENT_ANSWER, "sources": []}
    messages = build_messages(question, sources)
    try:
        answer_text = llm_fn(messages, settings)
    except LLMError as exc:
        logger.error("llm failed: %s", exc)
        raise
    logger.info("answer: sources=%d, len=%d", len(sources), len(answer_text))
    return {"answer": answer_text, "sources": sources}
