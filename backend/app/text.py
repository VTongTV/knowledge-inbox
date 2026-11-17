"""sentence chunking, html text extraction, and server-side url fetch"""

import logging
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

_SENTENCE = re.compile(r"[^.!?\n]+[.!?]*")
_SKIP_TAGS = frozenset({"script", "style"})
_ALLOWED_SCHEMES = frozenset({"http", "https"})
_USER_AGENT = "KnowledgeInbox/0.1 (server-side page fetcher)"


class FetchError(ValueError):
    """raise when a url scheme is not http(s) or the server does not return 2xx"""


def _split_sentences(text: str) -> list[str]:
    """split text at . ! ? and newline, keep the punctuation, drop empty parts"""
    sentences: list[str] = []
    for piece in _SENTENCE.findall(text):
        clean = " ".join(piece.split())
        if clean:
            sentences.append(clean)
    return sentences


def _overlap_tail(sentences: list[str], overlap: int) -> list[str]:
    """trailing sentences of a chunk whose joined length stays under overlap"""
    tail: list[str] = []
    for sentence in reversed(sentences):
        if len(" ".join([sentence, *tail])) >= overlap:
            break
        tail.insert(0, sentence)
    return tail


def chunk_text(text: str, size: int = 400, overlap: int = 60) -> list[str]:
    """split text into chunks of size chars, neighbours share an overlap tail"""
    if size <= 0:
        raise ValueError(f"size must be positive, got {size}")
    sentences = _split_sentences(text)
    if not sentences:
        return []
    chunks: list[str] = []
    current: list[str] = []
    for sentence in sentences:
        if current and len(" ".join([*current, sentence])) > size:
            chunks.append(" ".join(current))
            current = _overlap_tail(current, overlap)
            if current and len(" ".join([*current, sentence])) > size:
                current = []
        # ponytail: a sentence longer than size overflows on its own, so no split
        # runs inside a sentence; add a word boundary split when the embed model
        # rejects long chunks
        current.append(sentence)
    chunks.append(" ".join(current))
    return chunks


class _TextExtractor(HTMLParser):
    """collect text nodes and drop script and style bodies"""

    def __init__(self) -> None:
        """start with an empty buffer and no open skip region"""
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth: int = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """open a skip region when tag is script or style"""
        if tag in _SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        """close a skip region when tag is script or style"""
        if tag in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)

    def handle_data(self, data: str) -> None:
        """write data to the buffer only when no skip region is open"""
        if self._skip_depth == 0:
            self.parts.append(data)


def extract_text(html: str) -> str:
    """visible text of html, entity refs decoded and whitespace collapsed"""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return " ".join(" ".join(parser.parts).split())


def fetch_url(
    url: str,
    timeout: float = 10.0,
    transport: httpx.BaseTransport | None = None,
) -> str:
    """return the body text of url, or raise FetchError on a bad scheme or status"""
    scheme = urlparse(url).scheme
    if scheme not in _ALLOWED_SCHEMES:
        raise FetchError(
            f"only http and https are allowed, got {scheme or 'no'} scheme for {url}"
        )
    try:
        with httpx.Client(
            transport=transport, follow_redirects=True, timeout=timeout, headers={"User-Agent": _USER_AGENT}
        ) as client:
            response = client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("fetch failed for %s: %s", url, exc)
        raise
    if not response.is_success:
        logger.warning("fetch returned %d for %s", response.status_code, url)
        raise FetchError(f"fetch returned {response.status_code} for {url}")
    logger.info("fetched %d bytes from %s", len(response.content), response.url)
    return response.text
