"""runtime settings; this is the only module that reads the environment"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _env(name: str, fallback: str) -> str:
    """return env name, or fallback when the value is empty"""
    value = os.environ.get(name, "")
    return value if value else fallback


def _env_bool(name: str, fallback: bool) -> bool:
    """return env name as a bool, or fallback when the value is empty"""
    value = os.environ.get(name, "")
    if not value:
        return fallback
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    """every knob the app reads; no other module touches os.environ"""

    db_path: str
    llm_base_url: str
    llm_model: str
    llm_api_key: str
    top_k: int
    chunk_size: int
    chunk_overlap: int
    embed_model: str
    embed_dim: int
    fetch_timeout: float
    llm_timeout: float
    cors_origins: list[str]
    min_chunk_score: float
    rerank_enabled: bool
    rerank_model: str


def load_settings() -> Settings:
    """build settings from the environment plus the shipped defaults"""
    return Settings(
        db_path=_env("KNOWLEDGE_INBOX_DB", "knowledge_inbox.db"),
        llm_base_url=_env("LLM_BASE_URL", "https://openrouter.ai/api/v1"),
        llm_model=_env("LLM_MODEL", "baidu/ernie-5.5-flash-preview:free"),
        llm_api_key=os.environ.get("OPENROUTER_API_KEY", ""),
        top_k=int(_env("TOP_K", "5")),
        chunk_size=int(_env("CHUNK_SIZE", "400")),
        chunk_overlap=int(_env("CHUNK_OVERLAP", "60")),
        embed_model=_env("EMBED_MODEL", "BAAI/bge-small-en-v1.5"),
        embed_dim=int(_env("EMBED_DIM", "384")),
        fetch_timeout=float(_env("FETCH_TIMEOUT", "10")),
        llm_timeout=float(_env("LLM_TIMEOUT", "60")),
        cors_origins=_env("CORS_ORIGINS", "http://localhost:5173").split(","),
        # a chunk must score at least this on the cosine leg to reach the prompt;
        # the live corpus tests out around 0.64 for weak hits.
        min_chunk_score=float(_env("MIN_CHUNK_SCORE", "0.45")),
        rerank_enabled=_env_bool("RERANK_ENABLED", True),
        rerank_model=_env("RERANK_MODEL", "answerdotai/answerai-colbert-small-v1"),
    )
