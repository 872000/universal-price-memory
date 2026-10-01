const tokenCache = new WeakMap();

function normalise(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compact(value) {
  return normalise(value).replace(/\s+/g, "");
}

function productSearchText(product) {
  return [
    product.name,
    product.brand,
    product.category,
    product.size,
    product.stockcode,
    product.promo,
  ]
    .map(normalise)
    .filter(Boolean)
    .join(" ");
}

function productTokens(product) {
  if (!tokenCache.has(product)) {
    tokenCache.set(product, productSearchText(product).split(/\s+/).filter(Boolean));
  }
  return tokenCache.get(product);
}

function levenshteinWithin(left, right, maxDistance) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > maxDistance) return false;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return false;
    previous = current;
  }
  return previous[right.length] <= maxDistance;
}

function fuzzyTokenMatch(queryToken, candidateToken) {
  if (!queryToken) return true;
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;
  if (queryToken.length < 4 || candidateToken.length < 4) return false;
  const maxDistance = queryToken.length >= 8 ? 2 : 1;
  return levenshteinWithin(queryToken, candidateToken, maxDistance);
}

export function matchesProductSearch(product, rawQuery) {
  const query = normalise(rawQuery);
  if (!query) return true;

  const haystack = productSearchText(product);
  const compactHaystack = haystack.replace(/\s+/g, "");
  const compactQuery = compact(query);
  if (haystack.includes(query) || compactHaystack.includes(compactQuery)) return true;

  const tokens = productTokens(product);
  return query.split(/\s+/).every((queryToken) => tokens.some((token) => fuzzyTokenMatch(queryToken, token)));
}

export const searchInternals = {
  compact,
  fuzzyTokenMatch,
  normalise,
  productSearchText,
};
