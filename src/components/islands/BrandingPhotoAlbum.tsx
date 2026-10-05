import PhotoAlbum from "react-photo-album";
import type { Photo } from "react-photo-album";

export interface BrandingPhotoAlbumProps {
  photos: Photo[];
}

const GAP = 12;

export default function BrandingPhotoAlbum({ photos }: BrandingPhotoAlbumProps) {
  return (
    <div className="branding-photo-album min-w-0 w-full max-w-full">
      <PhotoAlbum
        photos={photos}
        layout="rows"
        spacing={GAP}
        padding={0}
        targetRowHeight={(containerWidth) =>
          containerWidth < 768 ? 320 : 220
        }
        rowConstraints={(containerWidth) =>
          containerWidth < 768
            ? { maxPhotos: 1 }
            : { maxPhotos: 2, minPhotos: 1 }
        }
        sizes={{
          size: "min(100%, calc(100vw - 2rem))",
          sizes: [
            {
              viewport: "(min-width: 768px)",
              size: "min(100%, calc(100vw - 8rem))",
            },
          ],
        }}
        defaultContainerWidth={768}
        renderPhoto={({ renderDefaultPhoto, wrapperStyle }) => (
          <div
            style={wrapperStyle}
            className="overflow-hidden rounded-card border border-border bg-skeleton"
          >
            {renderDefaultPhoto({ wrapped: true })}
          </div>
        )}
      />
    </div>
  );
}
