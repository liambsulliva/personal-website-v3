// Types for albums.mjs, so TypeScript callers (tests) get checked signatures.

export type FolderEntry = string | { name: string; tags?: string[] };

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
  /** EXIF `YYYY:MM:DD HH:MM:SS`, or null. */
  taken: string | null;
};

export type AlbumHow = "dated" | "ambiguous" | "inferred";

export type ProposedAlbum = {
  slug: string;
  title: string;
  folder: string;
  year: number;
  date: string | null;
  photos: { id: string; how: AlbumHow | string }[];
};

export type Proposal = { albums: ProposedAlbum[]; unassigned: string[] };

export type PhotoResource = { public_id: string; secure_url: string; width: number; height: number };

export type SiteAlbum = {
  slug: string;
  title: string;
  date: string | null;
  year: number;
  count: number;
  preview: PhotoResource[];
};

export declare const MIN_ALBUM_PHOTOS: number;
export declare const albumTag: (slug: string) => string;
export declare function captureDay(taken: unknown): string | null;
export declare function parseFolderName(raw: string, year: number): ParsedFolderName;
export declare const hintTags: (title: string) => string[];
export declare function parseFolders(json: Record<string, FolderEntry[]>): Folder[];
export declare function proposeAlbums(folders: Folder[], photos: SourcePhoto[]): Proposal;
export declare function siteAlbums(
  proposal: Proposal,
  byId: Map<string, PhotoResource>,
  exif: Record<string, string | null | undefined>,
): SiteAlbum[];
export declare function toAlbumsModule(
  proposal: Proposal,
  byId: Map<string, PhotoResource>,
  exif: Record<string, string | null | undefined>,
): string;
