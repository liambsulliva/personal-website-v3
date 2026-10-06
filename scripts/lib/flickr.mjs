// Flickr REST reads for scripts/photo-albums.mjs. The Cloudinary copies of
// Flickr originals lost their EXIF, but Flickr kept each photo's date taken.
// Public photos only, so an API key is enough (no OAuth).

import { flickrTaken } from "./albums.mjs";

const REST = "https://www.flickr.com/services/rest/";

async function call(apiKey, method, params) {
  const query = new URLSearchParams({ method, api_key: apiKey, format: "json", nojsoncallback: "1", ...params });
  const res = await fetch(`${REST}?${query}`);
  const data = await res.json();
  if (data.stat !== "ok") throw new Error(`${method} failed: ${data.message ?? res.status}`);
  return data;
}

/** Flickr photo id → EXIF-form date taken (or null), for every public photo
 *  of `userId`: 500 a call. */
export async function accountDates(apiKey, userId) {
  const dates = {};
  for (let page = 1, pages = 1; page <= pages; page += 1) {
    const { photos } = await call(apiKey, "flickr.people.getPhotos", {
      user_id: userId,
      extras: "date_taken",
      per_page: "500",
      page: String(page),
    });
    pages = photos.pages;
    for (const photo of photos.photo) dates[photo.id] = flickrTaken(photo.datetaken, photo.datetakenunknown);
  }
  return dates;
}

/** One photo's date taken, for photos outside the account listing. */
export async function photoDate(apiKey, photoId) {
  try {
    const { photo } = await call(apiKey, "flickr.photos.getInfo", { photo_id: photoId });
    return flickrTaken(photo.dates?.taken, photo.dates?.takenunknown);
  } catch {
    return null; // private, deleted, or not public
  }
}
