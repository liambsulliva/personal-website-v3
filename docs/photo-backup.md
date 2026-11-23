# Off-NAS backup of `Published`

Why: the `photography` snapshots stay on the NAS, so they don't survive losing it. iDrive is a deprecated method today; Liam plans to sync the whole share there later. Cloudinary is the only other copy of these exact files until one of them has run, so it stays open until a restore from one has worked.

Size on 2026-11-23: 3.3 GB (841 photos, 79 site images). R2's free allowance is 10 GB-month of Standard storage, 1 million writes and 10 million reads a month, with free egress ([pricing](https://developers.cloudflare.com/r2/pricing/)). Backup versions count towards the 10 GB.

None of this has been run. There is no official Cloudflare guide for Hyper Backup; the server settings below follow [Synology's note on S3-compatible servers](https://kb.synology.com/sv-se/DSM/help/HyperBackup/data_backup_destination) (path-style buckets need "Custom Server URL" and signature V4) and a [third-party write-up](https://carluve-dev.pages.dev/posts/2026/synology-backup-cloudflare-r2).

1. **Bucket:** Cloudflare dashboard > R2 > Create bucket, for example `nas-published`. Standard storage, private. Enabling R2 asks for a payment method.
2. **Key:** R2 > Manage API tokens > create one with Object Read & Write, limited to that bucket. Keep the access key id and secret for step 3, and the account's endpoint `<account id>.r2.cloudflarestorage.com`.
3. **Task:** DSM > Hyper Backup > new data backup task > S3 Storage.
   - S3 server: Custom Server URL. Address: the endpoint. Signature version: v4. Region, if asked: `auto`.
   - Bucket: the one from step 1. Directory: `published`.
   - Source: only `photography/Published`. It includes `.site/index.json`, which holds the ids, tags and album links that the files don't.
   - Turn on client-side encryption, and keep the key file and password somewhere other than the NAS: without them the backup can't be opened.
   - Schedule: daily at night. Rotation: Smart Recycle, at most 30 versions. Integrity check: weekly.
4. **Restore test:** restore one album and `.site/index.json` to a scratch folder, and compare their checksums with the originals. Cloudinary can close only after this.

A sync isn't a backup: a deletion or a corrupted file is copied too. If iDrive replaces this, it needs versions turned on, and the same restore test.
