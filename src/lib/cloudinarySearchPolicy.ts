const MAX_PUBLIC_RESULTS = 50;
const MAX_EXCLUDED_IDS = 50;
const SAFE_TAG_PATTERN = /^[A-Za-z0-9_.:-]+$/;

type PublicSearchBody = {
  excludeIds?: string[];
  expression: string;
  max_results: number;
  next_cursor?: string;
  randomize?: boolean;
  with_field?: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isSafeTagExpression = (expression: string) => {
  const tagPrefix = "resource_type:image AND tags=";

  if (!expression.startsWith(tagPrefix)) {
    return false;
  }

  const tag = expression.slice(tagPrefix.length);

  return SAFE_TAG_PATTERN.test(tag);
};

const isAllowedPublicExpression = (expression: string) =>
  expression === "resource_type:image" || isSafeTagExpression(expression);

const sanitizeWithFields = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const fields = value.filter(
    (field): field is string => field === "tags" || field === "context",
  );

  return fields.length > 0 ? fields : undefined;
};

const sanitizeExcludeIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids = value
    .filter((id): id is string => typeof id === "string")
    .slice(0, MAX_EXCLUDED_IDS);

  return ids.length > 0 ? ids : undefined;
};

export const sanitizePublicCloudinarySearch = (
  body: unknown,
): PublicSearchBody | null => {
  if (!isObject(body) || typeof body.expression !== "string") {
    return null;
  }

  if (!isAllowedPublicExpression(body.expression)) {
    return null;
  }

  const requestedMaxResults =
    typeof body.max_results === "number" ? body.max_results : 20;
  const maxResults = Math.min(
    Math.max(Math.floor(requestedMaxResults), 1),
    MAX_PUBLIC_RESULTS,
  );
  const randomize = body.randomize === true;

  if (randomize && body.expression !== "resource_type:image") {
    return null;
  }

  const sanitized: PublicSearchBody = {
    expression: body.expression,
    max_results: maxResults,
  };
  const withField = sanitizeWithFields(body.with_field);
  const excludeIds = sanitizeExcludeIds(body.excludeIds);

  if (withField) {
    sanitized.with_field = withField;
  }

  if (randomize) {
    sanitized.randomize = true;
  }

  if (excludeIds) {
    sanitized.excludeIds = excludeIds;
  }

  if (typeof body.next_cursor === "string" && body.next_cursor.length <= 512) {
    sanitized.next_cursor = body.next_cursor;
  }

  return sanitized;
};

export function publicCloudinarySearchUrl(params: {
  expression: string;
  max_results: number;
  next_cursor?: string | null;
}): string {
  const search = new URLSearchParams({
    expression: params.expression,
    max_results: String(params.max_results),
  });

  if (params.next_cursor) {
    search.set("next_cursor", params.next_cursor);
  }

  return `/api/cloudinary/search?${search}`;
}
