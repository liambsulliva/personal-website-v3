// Types for albums.mjs, so TypeScript callers (tests) get checked signatures.

export type FolderEntry = string | { name: string; tags?: string[]; imported?: string; root?: string };

export type ParsedFolderName = {
  title: string;
  start: string | null;
  end: string | null;
  loose?: true;
};

export type Folder = {
  slug: string;
  folder: string;
  title: string;
  year: number;
  start: string | null;
  end: string | null;
  loose: boolean;
  tags: string[];
};

export type SourcePhoto = {
  public_id: string;
  tags?: string[];
  /** ISO upload time. */
  created_at: string;
  /** EXIF `YYYY:MM:DD HH:MM:SS` (or Flickr's date taken in that form), or null. */
  taken: string | null;
  /** Original filename (Admin API `original_filename`). */
  file?: string | null;
};

export type AlbumHow = "nas" | "named" | "dated" | "nearby" | "ambiguous" | "inferred";

export type ProposedAlbum = {
  slug: string;
  title: string;
  folder: string;
  year: number;
  date: string | null;
  photos: { id: string; how: AlbumHow | string }[];
};

export type Proposal = { albums: ProposedAlbum[]; unassigned: string[] };

export type SiteAlbum = {
  slug: string;
  title: string;
  date: string | null;
  year: number;
  count: number;
  photos: string[];
  preview: { public_id: string; secure_url: string }[];
};

export declare const MIN_ALBUM_PHOTOS: number;
export declare function captureDay(taken: unknown): string | null;
export declare function parseFolderName(raw: string, year: number): ParsedFolderName;
export declare const hintTags: (title: string) => string[];
export declare function parseFolders(json: Record<string, FolderEntry[]>): Folder[];
export declare function proposeAlbums(
  folders: Folder[],
  photos: SourcePhoto[],
  options?: { nasHits?: Record<string, string[]> },
): Proposal;
export declare function siteAlbums(
  proposal: Proposal,
  taken: Record<string, string | null | undefined>,
  cloudName: string,
): SiteAlbum[];
export declare function albumYaml(album: Pick<SiteAlbum, "title" | "year" | "date" | "count" | "photos">): string;

export declare function flickrIdOf(file: string | null | undefined): string | null;
export declare function flickrTaken(datetaken: string | null | undefined, unknown?: string | number): string | null;
export declare function photoName(publicId: string, file?: string | null): string | null;
export declare function cameraStem(file: string | null | undefined): string | null;
export declare function shootOf(path: string): string | null;
