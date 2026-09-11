function normalizeForSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  return normalizeForSearch(input)
    .split(" ")
    .filter(Boolean);
}

function hasOrderedWordMatch(titleTokens: string[], queryTokens: string[]): boolean {
  let currentIndex = -1;

  for (const token of queryTokens) {
    const nextIndex = titleTokens.findIndex(
      (value, index) => index > currentIndex && value === token,
    );

    if (nextIndex === -1) {
      return false;
    }

    currentIndex = nextIndex;
  }

  return true;
}

export function getTitleRelevanceScore(title: string, query: string): number {
  const normalizedTitle = normalizeForSearch(title);
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedTitle === normalizedQuery) {
    return 100000;
  }

  const titleTokens = tokenize(title);
  const queryTokens = tokenize(query);

  if (titleTokens.length === 0 || queryTokens.length === 0) {
    return 0;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 90000 - titleTokens.length;
  }

  const firstToken = queryTokens[0];
  const hasFirstWordMatch = titleTokens[0] === firstToken;
  const orderedMatch = hasOrderedWordMatch(titleTokens, queryTokens);
  const allWordsPresent = queryTokens.every((token) => titleTokens.includes(token));

  if (hasFirstWordMatch && orderedMatch) {
    return 80000 - titleTokens.length;
  }

  if (titleTokens.includes(firstToken) && orderedMatch) {
    return 70000 - titleTokens.length;
  }

  if (allWordsPresent) {
    return 60000 - titleTokens.length;
  }

  return 0;
}

export function sortBySearchRelevance<T extends { name: string }>(items: T[], query: string): T[] {
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return [...items];
  }

  return [...items].sort((left, right) => {
    const leftScore = getTitleRelevanceScore(left.name, query);
    const rightScore = getTitleRelevanceScore(right.name, query);

    return rightScore - leftScore;
  });
}
