// knowledge inbox api client. the only module that calls fetch.

const envBase = (import.meta.env as { VITE_API_URL?: string }).VITE_API_URL

/** api root. vite_api_url wins, else the local dev server answers on port 8000. */
export const API_BASE: string = envBase ?? "http://localhost:8000"

/** carries the http status next to the server message. */
export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

/** the two ingest kinds the server accepts. */
export type ItemType = "note" | "url"

/** what POST /ingest returns, with the count of chunks the server stored. */
export interface IngestedRow {
  id: number
  type: string
  source: string
  created_at: string
  chunks: number
}

/** one row of GET /items, where preview holds the first characters of the content. */
export interface SavedItem {
  id: number
  type: ItemType
  source: string
  created_at: string
  preview: string
  chunk_count: number
}

/** one cited chunk that the answer rests on. */
export interface CitedSource {
  item_id: number
  chunk_index: number
  text: string
  score: number
}

/** what POST /query returns: the answer plus the chunks it cites. */
export interface AskResult {
  answer: string
  sources: CitedSource[]
}

/** pulls one readable line out of a pydantic error entry. */
function fieldMessage(entry: unknown): string {
  if (entry !== null && typeof entry === "object" && "msg" in entry) {
    const msg = (entry as Record<string, unknown>).msg
    if (typeof msg === "string") return msg
  }
  return ""
}

/** builds the ApiError for a bad status, and keeps the status text when the body holds no message. */
async function failure(res: Response): Promise<ApiError> {
  const fallback = `request failed with status ${res.status}`
  let detail = fallback
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === "string" && body.detail.length > 0) {
      detail = body.detail
    } else if (Array.isArray(body.detail)) {
      const joined = body.detail
        .map(fieldMessage)
        .filter((message) => message.length > 0)
        .join(", ")
      detail = joined.length > 0 ? joined : fallback
    }
  } catch {
    // the body held no json, so keep the status text
  }
  return new ApiError(res.status, detail)
}

/** one fetch call. throws ApiError on a bad status, else returns the parsed body. */
async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, init)
  if (!res.ok) throw await failure(res)
  return (await res.json()) as T
}

/** posts one note or url, then returns the row the server saved. */
export async function ingestNoteOrUrl(
  kind: ItemType,
  content: string,
  signal?: AbortSignal,
): Promise<IngestedRow> {
  return call<IngestedRow>("/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: kind, content }),
    signal,
  })
}

/** lists every saved item. */
export async function fetchItems(signal?: AbortSignal): Promise<SavedItem[]> {
  return call<SavedItem[]>("/items", { signal })
}

/** asks one question over the saved content. */
export async function askQuestion(question: string, signal?: AbortSignal): Promise<AskResult> {
  return call<AskResult>("/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  })
}

/** maps any failure to one user-readable line, and names the server when the network fails. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof TypeError) return `cannot reach the server at ${API_BASE}`
  if (err instanceof Error) return err.message
  return "an unexpected failure occurred"
}
