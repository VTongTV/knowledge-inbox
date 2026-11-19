"""text to float32 vectors; fastembed runs the bge-small model on cpu"""

import logging
from functools import lru_cache

import numpy as np
from fastembed import LateInteractionTextEmbedding, TextEmbedding

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
DEFAULT_RERANK_MODEL = "answerdotai/answerai-colbert-small-v1"


@lru_cache(maxsize=None)
def get_model(model_name: str = DEFAULT_MODEL) -> TextEmbedding:
    """build model_name one time and keep it in memory"""
    logger.info("build embedding model %s now", model_name)
    return TextEmbedding(model_name=model_name)


@lru_cache(maxsize=None)
def get_rerank_model(model_name: str = DEFAULT_RERANK_MODEL) -> LateInteractionTextEmbedding:
    """build the late interaction reranker once and keep it in memory"""
    logger.info("build reranker %s now", model_name)
    return LateInteractionTextEmbedding(model_name=model_name)


def embed(texts: list[str], model_name: str = DEFAULT_MODEL) -> list[np.ndarray]:
    """one float32 384-dim vector per text, input order; empty list gives []"""
    if not texts:
        return []
    blank = sum(1 for text in texts if not text.strip())
    if blank:
        logger.debug(
            "%d blank texts in batch; fastembed gives a meaningless vector for each", blank
        )
    vectors = [
        np.asarray(vector, dtype=np.float32)
        for vector in get_model(model_name).embed(texts)
    ]
    logger.info(
        "embedded %d texts with %s at dim %d",
        len(vectors),
        model_name,
        vectors[0].size,
    )
    return vectors


def _maxsim(query_tokens: np.ndarray, passage_tokens: np.ndarray) -> float:
    """sum of the best passage score per query token"""
    sim = query_tokens @ passage_tokens.T
    return float(sim.max(axis=1).sum())


def rerank(
    question: str,
    passages: list[str],
    model_name: str = DEFAULT_RERANK_MODEL,
) -> list[float]:
    """one relevance score per passage, input order; empty list gives []"""
    if not passages:
        return []
    try:
        model = get_rerank_model(model_name)
        query_tokens = list(model.query_embed([question]))
        passage_tokens = list(model.passage_embed(passages))
        scores = [
            _maxsim(np.asarray(query_tokens[0], dtype=np.float32), np.asarray(passage, dtype=np.float32))
            for passage in passage_tokens
        ]
    except Exception as exc:
        logger.warning(
            "reranker %s failed (%s); the fused order is kept", model_name, exc
        )
        scores = [1.0] * len(passages)
    logger.info(
        "reranked %d passages for a question of %d chars with %s",
        len(passages),
        len(question),
        model_name,
    )
    return scores
