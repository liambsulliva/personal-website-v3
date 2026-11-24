// The one-time copy of the old album YAML into album.yaml files.
import { describe, expect, it } from "vitest";
import { planCopy } from "../../scripts/album-yaml.mjs";
import { emptyIndex } from "../../services/lib/index.mjs";
import { parseAlbumFile, parseOldAlbum } from "../../services/photos/albumFile.mjs";

const photo = (path: string) => ({ path, kind: "photo", takenAt: null, createdAt: "2026-05-01T00:00:00.000Z" });
const ids = ["e", "d", "c", "b", "a"];
function setup() {
  const index: any = emptyIndex();
  for (const id of ids) index.photos[id] = photo(`Puli's Car Show 4-11/${id}.jpg`);
  index.albums = { "2026-puli-s-car-show-0411": { folder: "Puli's Car Show 4-11", known: ids } };
  const old = [{ slug: "2026-puli-s-car-show-0411", title: "Puli's Car Show", year: 2021, date: "2021-04-11", photos: ids }];
  return { index, old };
}

describe("album.yaml from the old albums", () => {
  it("reads the old files", () => {
    expect(parseOldAlbum('# note\ntitle: "X: y"\nyear: 2024\ndate: 2024-02-03\ncount: 1\nphotos:\n  - "0123"\n')).toEqual({ title: "X: y", year: 2024, date: "2024-02-03", photos: ["0123"] });
    expect(parseOldAlbum("title: X\nyear: 2026\ndate: null\nphotos:\n  - a\n").date).toBeNull();
  });

  it("keeps link, date and order, and changes nothing visible", () => {
    const { index, old } = setup();
    const before = structuredClone(index);
    const { files, problems, differences } = planCopy({ old, index } as any);
    expect([problems, differences]).toEqual([[], []]);
    expect(files).toMatchObject([{ folder: "Puli's Car Show 4-11", state: "new" }]);
    expect(parseAlbumFile(files[0].text)).toEqual({ link: "2026-puli-s-car-show-0411", date: "2021-04-11", order: ids.map((id) => `${id}.jpg`) });
    expect(index).toEqual(before);
  });

  it("can be run again, and leaves what's there alone", () => {
    const { index, old } = setup();
    const { text } = planCopy({ old, index } as any).files[0];
    expect(planCopy({ old, index, read: () => text } as any)).toMatchObject({ files: [{ state: "same", text }], differences: [] });
    const mine = "link: 2026-puli-s-car-show-0411\ndate: 2021-04-12\n";
    const again = planCopy({ old, index, read: () => mine } as any);
    expect(again.files).toMatchObject([{ state: "differs", kept: ["date", "order"], text: mine }]);
    expect(again.differences).toEqual([expect.stringContaining("date differs"), expect.stringContaining("photos differs")]);
  });

  it("says what it can't copy", () => {
    const { index, old } = setup();
    index.photos.a.path = "Other/a.jpg";
    delete index.photos.b;
    expect(planCopy({ old, index } as any).problems).toEqual([expect.stringContaining("1 photos aren't published (b)"), expect.stringContaining("2 folders")]);
    expect(planCopy({ old: [...setup().old, { ...setup().old[0], slug: "twin" }], index: setup().index } as any).problems).toEqual([expect.stringContaining("already belongs")]);
  });
});
