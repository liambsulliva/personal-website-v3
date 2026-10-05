// Read-only Cloudinary Admin/Search access for SSR pages and the public API
// routes. Photography lives at the cloud root (tag-driven); site imagery
// lives under folder site/ and is always excluded from photo queries.

export const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";

export const PHOTO_SCOPE = "NOT folder:site/*";

export const getCloudinaryCredentials = () => {
  const cloudName = import.meta.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = import.meta.env.CLOUDINARY_API_KEY;
  const apiSecret = import.meta.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  return { apiKey, apiSecret, cloudName };
};

export type PhotoResource = {
  public_id: string;
  secure_url: string;
  width: number;
  height: number;
};

export type PhotoPage = {
  resources: PhotoResource[];
  next_cursor?: string;
};

const authHeader = (apiKey: string, apiSecret: string) =>
  `Basic ${btoa(`${apiKey}:${apiSecret}`)}`;

/** Scope a public photo expression to the photography library. */
export const scopePhotoExpression = (expression: string) => `${expression} AND ${PHOTO_SCOPE}`;

export const photoExpression = (tag?: string | null) =>
  tag ? `resource_type:image AND tags=${tag}` : "resource_type:image";

export async function searchPhotos(body: {
  expression: string;
  max_results: number;
  next_cursor?: string;
  sort_by?: Array<Record<string, "asc" | "desc">>;
}): Promise<{ ok: boolean; status: number; data: PhotoPage }> {
  const credentials = getCloudinaryCredentials();
  if (!credentials) return { ok: false, status: 500, data: { resources: [] } };

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${credentials.cloudName}/resources/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(credentials.apiKey, credentials.apiSecret),
      },
      body: JSON.stringify({
        sort_by: [{ created_at: "desc" }],
        ...body,
        expression: scopePhotoExpression(body.expression),
      }),
    },
  );

  const text = await response.text();
  let raw: { resources?: Array<Record<string, unknown>>; next_cursor?: string } = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, status: 502, data: { resources: [] } };
  }

  return {
    ok: response.ok,
    status: response.status,
    data: {
      resources: (raw.resources ?? []).map(({ public_id, secure_url, width, height }) => ({
        public_id: public_id as string,
        secure_url: secure_url as string,
        width: width as number,
        height: height as number,
      })),
      next_cursor: raw.next_cursor,
    },
  };
}

/** Tags for the chip row. `featured` is an editorial flag, not a filter. */
export async function listPhotoTags(): Promise<string[]> {
  const credentials = getCloudinaryCredentials();
  if (!credentials) return [];

  const tags: string[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ max_results: "500" });
    if (cursor) params.set("next_cursor", cursor);
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${credentials.cloudName}/tags/image?${params}`,
      { headers: { Authorization: authHeader(credentials.apiKey, credentials.apiSecret) } },
    );
    if (!response.ok) break;
    const data: { tags?: string[]; next_cursor?: string | null } = await response.json();
    tags.push(...(data.tags ?? []));
    cursor = data.next_cursor || undefined;
  } while (cursor);

  return tags.filter((tag) => tag !== "featured").sort();
}
