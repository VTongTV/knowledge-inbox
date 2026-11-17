"""tests for sentence chunking, html extraction, and url fetch"""

import httpx
import pytest

from app.text import FetchError, chunk_text, extract_text, fetch_url


def test_empty_text_returns_no_chunks() -> None:
    """an empty string holds nothing to chunk"""
    assert chunk_text("") == []


def test_whitespace_only_returns_no_chunks() -> None:
    """a blank note holds nothing to chunk"""
    assert chunk_text("   \n\t ") == []


def test_short_text_returns_one_cleaned_chunk() -> None:
    """text under size returns one chunk with spaces collapsed"""
    assert chunk_text("  hello   world  ") == ["hello world"]


def test_sentence_punctuation_is_kept() -> None:
    """the period, the exclamation mark, and the question mark stay"""
    assert chunk_text("One. Two! Three?") == ["One. Two! Three?"]


def test_a_newline_starts_a_new_sentence() -> None:
    """a newline ends a sentence and becomes one space"""
    assert chunk_text("Line one\nLine two") == ["Line one Line two"]


def test_long_input_makes_overlapping_chunks() -> None:
    """a second chunk starts with the tail of the first chunk"""
    chunks = chunk_text("S1 alpha. S2 beta. S3 gamma. S4 delta.", size=20, overlap=10)
    assert len(chunks) == 3
    assert chunks[0].endswith("S2 beta.")
    assert chunks[1].startswith("S2 beta.")


def test_chunks_stay_within_size() -> None:
    """every chunk of short sentences fits the size limit"""
    text = " ".join(f"Sentence number {n} holds words." for n in range(30))
    chunks = chunk_text(text, size=80, overlap=20)
    assert len(chunks) > 1
    assert all(len(chunk) <= 80 for chunk in chunks)


def test_a_long_sentence_overflows_alone() -> None:
    """one sentence above size goes out as its own chunk"""
    text = "x" * 500 + "."
    chunks = chunk_text(text, size=50)
    assert chunks == [text]


def test_a_long_sentence_stands_alone_between_chunks() -> None:
    """a long sentence breaks the overlap chain around it"""
    long_sentence = "y" * 200 + "."
    chunks = chunk_text(f"Start here. {long_sentence} End here.", size=40, overlap=10)
    assert chunks == ["Start here.", long_sentence, "End here."]


def test_an_overlapping_seed_that_overflows_is_dropped() -> None:
    """an overlap tail goes away when the next chunk would pass size"""
    chunks = chunk_text("aaaa bbbb. cc dd. ee ff.", size=15, overlap=12)
    assert chunks == ["aaaa bbbb.", "cc dd. ee ff."]


def test_non_positive_size_raises() -> None:
    """a size of zero cannot bound a chunk"""
    with pytest.raises(ValueError) as excinfo:
        chunk_text("abc", size=0)
    assert "size must be positive" in str(excinfo.value)


def test_plain_text_passes_through() -> None:
    """text without tags comes back unchanged"""
    assert extract_text("hello world") == "hello world"


def test_tags_are_stripped() -> None:
    """tags leave only the text between them"""
    assert extract_text("<p>hello</p><p>world</p>") == "hello world"


def test_script_content_is_dropped() -> None:
    """the script body never reaches the text"""
    assert extract_text("<p>a</p><script>var x = 1;</script><p>b</p>") == "a b"


def test_style_content_is_dropped() -> None:
    """the style body never reaches the text"""
    assert extract_text("<style>.x { color: red }</style><p>text</p>") == "text"


def test_entities_are_decoded() -> None:
    """entity refs become the character that they name"""
    assert extract_text("<p>a &amp; b &lt;c&gt; &#39;q&#39;</p>") == "a & b <c> 'q'"


def test_whitespace_is_collapsed() -> None:
    """a run of spaces and newlines becomes one space"""
    assert extract_text("<div>  a \n\n  b  </div>") == "a b"


def test_attributes_are_dropped() -> None:
    """an attribute value is not text"""
    assert extract_text('<a href="https://example.com">link</a>') == "link"


def test_empty_html_returns_empty_text() -> None:
    """an empty page holds no text"""
    assert extract_text("") == ""


def test_script_only_html_returns_empty_text() -> None:
    """a page with one script tag holds no text"""
    assert extract_text("<script>x = 1;</script>") == ""


def test_a_non_http_scheme_raises() -> None:
    """ftp is not a fetchable scheme, and the message names it"""
    with pytest.raises(FetchError) as excinfo:
        fetch_url("ftp://example.com/file")
    assert "got ftp scheme" in str(excinfo.value)


def test_a_missing_scheme_raises() -> None:
    """a bare host name has no scheme to fetch"""
    with pytest.raises(ValueError) as excinfo:
        fetch_url("example.com/page")
    assert "got no scheme" in str(excinfo.value)


def test_fetch_url_returns_body_text() -> None:
    """a 200 response returns the body text"""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="page body")

    body = fetch_url("https://example.com/a", transport=httpx.MockTransport(handler))
    assert body == "page body"


def test_a_non_2xx_status_raises() -> None:
    """a 404 raises FetchError with the status and the url"""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="missing")

    with pytest.raises(FetchError) as excinfo:
        fetch_url("https://example.com/gone", transport=httpx.MockTransport(handler))
    message = str(excinfo.value)
    assert "404" in message
    assert "https://example.com/gone" in message


def test_a_network_error_propagates() -> None:
    """the httpx error reaches the caller after the warning log"""
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host")

    with pytest.raises(httpx.HTTPError):
        fetch_url("https://example.com/", transport=httpx.MockTransport(handler))


def test_redirects_are_followed() -> None:
    """a 302 response sends the client to the new location"""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(302, headers={"location": "/new"})
        return httpx.Response(200, text="landed")

    body = fetch_url("https://example.com/old", transport=httpx.MockTransport(handler))
    assert body == "landed"
