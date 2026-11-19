"""retrieve chunks, build the prompt, call the llm; one orchestration entry"""

import logging
import re
from typing import Callable

import httpx

from app.config import Settings, load_settings
from app.embed import embed, rerank
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

NO_MATCH_ANSWER = (
    "No saved source covers the question closely enough to answer it. "
    "Try a more specific question."
)

# tokens that blur a citation check; none carries retrieval signal.
_STOPWORDS = {
    "this", "that", "these", "those", "with", "from", "have", "where",
    "which", "their", "there", "they", "them", "been", "were", "what",
    "when", "then", "than", "about", "would", "could", "should",
}

_CITATION = re.compile(r"\[(\d+)\]")
_SENTENCE = re.compile(r"[.!?]\s+")


class LLMError(Exception):
    """raise when the llm endpoint fails or its answer is unusable"""


def retrieve(
    question: str,
    store: Store,
    settings: Settings,
    embed_fn: Callable[[list[str]], list] = embed,
) -> list[dict[str, object]]:
    """hybrid-search a pool, rerank it, drop chunks under the cutoff"""
    vectors = embed_fn([question])
    if not vectors:
        raise LLMError("question embedding returned no vector")
    pool = max(settings.top_k * 4, 10)
    hits = store.search(vectors[0], pool, query_text=question)
    logger.info("retrieve: question len=%d, pool=%d", len(question), len(hits))
    if settings.rerank_enabled and hits:
        scores = rerank(question, [str(hit["text"]) for hit in hits], settings.rerank_model)
        hits = [hit for _, hit in sorted(zip(scores, hits), key=lambda pair: pair[0], reverse=True)]
        logger.info("rerank reordered %d hits", len(hits))
    hits = [hit for hit in hits if float(hit["score"]) >= settings.min_chunk_score][: settings.top_k]
    logger.info("retrieve: kept=%d after cutoff %.2f", len(hits), settings.min_chunk_score)
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


def _window_around(text: str, marker: str) -> str:
    """the sentence that holds the marker, trimmed to one line"""
    index = text.find(marker)
    if index < 0:
        return ""
    terminators = list(_SENTENCE.finditer(text[:index]))
    start = terminators[-1].end() if terminators else 0
    after = _SENTENCE.search(text[index:])
    end = len(text) if after is None else index + after.end()
    return text[start:end]


def _significant_tokens(fragment: str) -> set[str]:
    """lowercase alphanumeric tokens of 4+ chars, stopwords dropped"""
    tokens = re.findall(r"[a-z0-9]+", fragment.lower())
    return {token for token in tokens if len(token) >= 4 and token not in _STOPWORDS}


def verify_citations(
    answer_text: str, sources: list[dict[str, object]]
) -> list[dict[str, object]]:
    """check each [n] against the window it sits in; mark the sources"""
    cited = {int(match.group(1)) for match in _CITATION.finditer(answer_text)}
    verified: list[bool] = []
    for index, source in enumerate(sources, start=1):
        if index not in cited:
            verified.append(False)
            continue
        window = _window_around(answer_text, f"[{index}]")
        window_tokens = _significant_tokens(window)
        source_tokens = _significant_tokens(str(source["text"]))
        verified.append(len(window_tokens & source_tokens) >= 2)
    for source, ok in zip(sources, verified, strict=True):
        source["verified"] = ok
    if cited:
        passed = sum(1 for ok in verified if ok)
        failed = sorted(n for n in cited if n > len(sources) or not sources[n - 1]["verified"])
        if failed:
            logger.warning("unverified citations: %s", failed)
        logger.info("citations: %d cited, %d verified", len(cited), passed)
    return sources


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
        has_content = bool(store.list_items())
        answer_text = NO_MATCH_ANSWER if has_content else NO_CONTENT_ANSWER
        logger.info(
            "no sources after cutoff; returned the %s answer",
            "no-match" if has_content else "empty-inbox",
        )
        return {"answer": answer_text, "sources": []}
    messages = build_messages(question, sources)
    try:
        answer_text = llm_fn(messages, settings)
    except LLMError as exc:
        logger.error("llm failed: %s", exc)
        raise
    sources = verify_citations(answer_text, sources)
    logger.info(
        "answer: sources=%d, len=%d", len(sources), len(answer_text)
    )
    return {"answer": answer_text, "sources": sources}
