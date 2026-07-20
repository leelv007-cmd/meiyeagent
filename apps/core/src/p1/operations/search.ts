import type { SearchDocument, SearchQuery, SearchResult } from './types.js';

function normalized(value: string) {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
}

const PRODUCT_SEARCH_QUERY_MAPPINGS = new Map([
  ['星眸款', '透亮猫眼'],
  ['效果反差图', '前后对比'],
]);

/** Product-owned non-literal aliases; provider search engines remain generic. */
export function mapProductSearchQuery(value: string) {
  return PRODUCT_SEARCH_QUERY_MAPPINGS.get(normalized(value)) ?? value;
}

export function chineseBigrams(value: string) {
  const text = normalized(value);
  if (text.length < 2) return text ? [text] : [];
  return Array.from({ length: text.length - 1 }, (_, index) =>
    text.slice(index, index + 2)
  );
}

function trigrams(value: string) {
  const text = `  ${normalized(value)}  `;
  if (text.length < 3) return text ? [text] : [];
  return Array.from({ length: text.length - 2 }, (_, index) =>
    text.slice(index, index + 3)
  );
}

function overlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token)).length / left.length;
}

export function rankSearchDocuments(
  documents: SearchDocument[],
  query: SearchQuery
): SearchResult[] {
  const needle = normalized(mapProductSearchQuery(query.query ?? ''));
  const queryBigrams = chineseBigrams(needle);
  const queryTrigrams = trigrams(needle);
  const tags = query.tags ?? [];
  const metadata = Object.entries(query.metadata ?? {});

  return documents
    .filter((document) => !query.kinds || query.kinds.includes(document.kind))
    .filter((document) => tags.every((tag) => document.tags.includes(tag)))
    .filter((document) =>
      metadata.every(([key, value]) => document.metadata[key] === value)
    )
    .map((document): SearchResult | null => {
      const haystack = normalized(
        `${document.title} ${document.text} ${document.tags.join(' ')}`
      );
      if (!needle) return { ...document, matchMode: 'structured', score: 1 };
      if (haystack === needle || normalized(document.title) === needle) {
        return { ...document, matchMode: 'exact', score: 10 };
      }
      if (haystack.includes(needle)) {
        return { ...document, matchMode: 'fts', score: 8 };
      }
      const bigramScore = overlap(queryBigrams, chineseBigrams(haystack));
      if (bigramScore >= 0.5) {
        return { ...document, matchMode: 'bigram', score: 4 + bigramScore };
      }
      const trigramScore = overlap(queryTrigrams, trigrams(haystack));
      if (trigramScore >= 0.35) {
        return { ...document, matchMode: 'trigram', score: 2 + trigramScore };
      }
      return null;
    })
    .filter((result): result is SearchResult => result !== null)
    .sort(
      (left, right) =>
        right.score - left.score || right.updatedAt.localeCompare(left.updatedAt)
    )
    .slice(0, query.limit ?? 20);
}
