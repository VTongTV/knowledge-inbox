"""text to float32 vectors; fastembed runs the bge-small model on cpu"""

import logging
from functools import lru_cache

import numpy as np
from fastembed import TextEmbedding

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"


@lru_cache(maxsize=None)
def get_model(model_name: str = DEFAULT_MODEL) -> TextEmbedding:
    """build model_name one time and keep it in memory"""
    logger.info("build embedding model %s now", model_name)
    return TextEmbedding(model_name=model_name)


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
