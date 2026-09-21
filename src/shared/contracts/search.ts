export interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

export interface SearchResponse {
  query: string
  searchedAt: string
  results: SearchResult[]
}

export interface SearchApi {
  search(input: { query: string; maxResults?: number }): Promise<SearchResponse>
}
