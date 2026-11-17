"""tests for the settings loader"""

from app.config import load_settings


def test_defaults_apply_when_env_is_unset(monkeypatch: object) -> None:
    """missing env vars fall back to the shipped defaults"""
    for name in (
        "KNOWLEDGE_INBOX_DB",
        "LLM_BASE_URL",
        "LLM_MODEL",
        "OPENROUTER_API_KEY",
        "TOP_K",
        "CHUNK_SIZE",
        "CHUNK_OVERLAP",
        "EMBED_MODEL",
        "EMBED_DIM",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = load_settings()
    assert settings.db_path == "knowledge_inbox.db"
    assert settings.llm_base_url == "https://openrouter.ai/api/v1"
    assert settings.llm_model == "baidu/ernie-5.5-flash-preview:free"
    assert settings.llm_api_key == ""
    assert settings.top_k == 5
    assert settings.chunk_size == 400
    assert settings.chunk_overlap == 60
    assert settings.embed_model == "BAAI/bge-small-en-v1.5"
    assert settings.embed_dim == 384


def test_env_values_override_the_defaults(monkeypatch: object) -> None:
    """a set env var wins over the default"""
    monkeypatch.setenv("KNOWLEDGE_INBOX_DB", "other.db")
    monkeypatch.setenv("LLM_MODEL", "other/model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sku-secret")
    monkeypatch.setenv("TOP_K", "9")
    settings = load_settings()
    assert settings.db_path == "other.db"
    assert settings.llm_model == "other/model"
    assert settings.llm_api_key == "sku-secret"
    assert settings.top_k == 9


def test_an_empty_env_value_falls_back(monkeypatch: object) -> None:
    """an empty string env var counts as unset"""
    monkeypatch.setenv("KNOWLEDGE_INBOX_DB", "")
    settings = load_settings()
    assert settings.db_path == "knowledge_inbox.db"
