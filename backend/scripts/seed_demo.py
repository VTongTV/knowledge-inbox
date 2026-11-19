"""seed the knowledge inbox db with realistic demo content; safe on an empty store"""

import argparse
import logging
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import load_settings
from app.embed import embed
from app.store import Store, StoreError
from app.text import FetchError, chunk_text, extract_text, fetch_url

logger = logging.getLogger(__name__)

DEMO_URL = "https://www.postgresql.org/docs/current/sql-insert.html"

NOTES = [
    (
        "Cosine similarity compares two embedding vectors. The formula is "
        "dot(a,b)/(|a||b|). Identical direction gives 1.0, orthogonal work "
        "gives 0.0. The knowledge inbox store keeps embeddings as JSON in the chunks "
        "table and runs numpy cosine against every row on every query. Past "
        "about fifty thousand chunks the linear scan dominates the latency "
        "budget and a real index is the next step."
    ),
    (
        "Sentence-aware chunking groups sentences into windows of about 400 "
        "characters with a 60 character overlap. The overlap exists so a "
        "thought that spans a boundary stays readable in both chunks. A "
        "question that asks about one half of the sentence still finds the "
        "other half."
    ),
    (
        "Hybrid retrieval wins on different questions. BM25 keyword ranking "
        "catches rare tokens: error codes, identifiers, flag names. Cosine "
        "embeddings catch paraphrase and loose meaning. Knowledge Inbox fuses both "
        "lists with reciprocal rank fusion, then reranks the top pool with a "
        "local late interaction model before the prompt is built."
    ),
    (
        "Citations in an LLM answer must be checked, never trusted. The "
        "verifier extracts every [n] marker, finds the sentence that carries "
        "it, and requires at least two significant tokens shared with the "
        "cited chunk. A source that fails is marked verified: false and the "
        "warning is logged with the index."
    ),
    (
        "The ingest path returns quickly and finishes in the background. "
        "POST /ingest validates and stores an empty shell, then returns 202 "
        "with status pending. The embed runs in a background task. The UI "
        "polls GET /items until the item carries chunks, then refreshes the "
        "drawer and toasts the outcome."
    ),
    (
        "FTS5 mirrors every chunk on write. The keyword leg reads that "
        "mirror. When the local sqlite build lacks FTS5, the store logs a "
        "warning and falls back to the vector leg alone. Nothing breaks; do "
        "not add a second dependency to paper over it."
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="seed the knowledge inbox db for a demo")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete every item and chunk first; destructive",
    )
    args = parser.parse_args()
    settings = load_settings()

    try:
        store = Store(settings.db_path)
    except StoreError as exc:
        print(f"cannot open store: {exc}")
        return 1

    existing = store.list_items()
    if existing:
        if not args.reset:
            print(
                f"{len(existing)} items already live in the store. "
                f"pass --reset to wipe and reseed; the existing data will be deleted."
            )
            store.close()
            return 1
        for item in existing:
            store.delete_item(int(item["id"]))
        print(f"wiped {len(existing)} items; reseed starting")

    total_chunks = 0
    for index, note in enumerate(NOTES, start=1):
        chunk_texts = chunk_text(
            note, size=settings.chunk_size, overlap=settings.chunk_overlap
        )
        vectors = embed(chunk_texts, model_name=settings.embed_model)
        item_id = store.add_item("note", note, "", chunk_texts, vectors)
        total_chunks += len(chunk_texts)
        print(f"seeded note {index}: item {item_id}, {len(chunk_texts)} chunks")

    try:
        page = fetch_url(DEMO_URL, timeout=settings.fetch_timeout)
        raw = extract_text(page)
    except (FetchError, httpx.HTTPError) as exc:
        print(f"could not fetch {DEMO_URL}: {exc}")
        print("notes are seeded; the url item is skipped.")
        store.close()
        return 0

    chunk_texts = chunk_text(raw, size=settings.chunk_size, overlap=settings.chunk_overlap)
    vectors = embed(chunk_texts, model_name=settings.embed_model)
    item_id = store.add_item("url", raw, DEMO_URL, chunk_texts, vectors)
    total_chunks += len(chunk_texts)
    print(f"seeded url: item {item_id}, {len(chunk_texts)} chunks")

    store.close()
    print(f"demo data ready: {total_chunks} chunks across the store")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
