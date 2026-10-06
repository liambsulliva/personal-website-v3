// Read-only Cloudinary Admin/Search access for SSR pages and the public API
// routes. Photography lives at the cloud root (tag-driven); site imagery
// lives under folder site/ and is always excluded from photo queries, as is
// the demo pack Cloudinary seeds into the console (tagged "samples").

export const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";

// Cloudinary's parser rejects chained NOTs; keep exclusions in one group.
export const PHOTO_SCOPE = "NOT (folder:site/* OR tags=samples)";

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

/** The photos with these public_ids (an album's), each matched exactly. */
export const idsExpression = (ids: readonly string[]) =>
  `resource_type:image AND (${ids.map((id) => `public_id="${id.replace(/"/g, "")}"`).join(" OR ")})`;

export const photoExpression = (tag?: string | null) =>
  tag ? `resource_type:image AND tags=${tag}` : "resource_type:image";

export async function searchPhotos(body: {
  expression: string;
  max_results: number;
  next_cursor?: string;
  sort_by?: Array<Record<string, "asc" | "desc">>;
  fields?: string[];
}): Promise<{ ok: boolean; status: number; data: PhotoPage & { tags?: string[][] } }> {
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

  const resources = raw.resources ?? [];
  return {
    ok: response.ok,
    status: response.status,
    data: {
      resources: resources.map(({ public_id, secure_url, width, height }) => ({
        public_id: public_id as string,
        secure_url: secure_url as string,
        width: width as number,
        height: height as number,
      })),
      // Only when `fields` asks for them, parallel to `resources`.
      ...(body.fields?.includes("tags") ? { tags: resources.map(({ tags }) => (Array.isArray(tags) ? tags : [])) } : {}),
      next_cursor: raw.next_cursor,
    },
  };
}

const POOL_FIELDS = ["public_id", "secure_url", "width", "height", "tags"];

/** Every photo matching `expression` with its tags, paged through Search 500
 *  at a time: one call for any current tag, two for all 841 photos. */
export async function searchAllPhotos(
  expression: string,
): Promise<{ ok: boolean; status: number; resources: PhotoResource[]; tags: string[] }> {
  const resources: PhotoResource[] = [];
  const tags = new Set<string>();
  let cursor: string | undefined;
  do {
    const { ok, status, data } = await searchPhotos({
      expression,
      max_results: 500,
      fields: POOL_FIELDS,
      ...(cursor ? { next_cursor: cursor } : {}),
    });
    if (!ok) return { ok, status, resources: [], tags: [] };
    resources.push(...data.resources);
    data.tags?.forEach((photoTags) => photoTags.forEach((tag) => tags.add(tag)));
    cursor = data.next_cursor;
  } while (cursor);
  return { ok: true, status: 200, resources, tags: publicTags(tags) };
}

/**
 * Tags for the chip row, read off the photos in PHOTO_SCOPE so a chip never
 * filters to an empty grid (the cloud-wide tag list includes tags that only
 * live on excluded assets). `featured` is an editorial flag, not a filter.
 * /photography gets them from its All pool instead (same Search calls).
 */
export async function listPhotoTags(): Promise<string[]> {
  return (await searchAllPhotos(photoExpression())).tags;
}

/** Chip-row tags: `featured` is editorial and `_`-prefixed tags are internal. */
export const publicTags = (tags: Iterable<string>) =>
  [...new Set(tags)].filter((tag) => tag !== "featured" && !tag.startsWith("_")).sort();
