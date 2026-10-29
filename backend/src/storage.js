// Image storage on local disk. Uploads are resized to fit 900x900 and saved
// as WebP in UPLOAD_DIR; the server serves them at /uploads/<file>.
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = resolve(join(__dirname, '..'), process.env.UPLOAD_DIR || 'uploads');
export const UPLOAD_URL = '/uploads';

mkdirSync(UPLOAD_DIR, { recursive: true });

// Resize + convert a Buffer, write it to disk, return its public URL.
export async function saveImage(buffer) {
  let out;
  try {
    out = await sharp(buffer)
      .rotate() // respect phone EXIF orientation
      .resize(900, 900, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    const err = new Error('That file is not a supported image.');
    err.status = 400;
    throw err;
  }
  const name = randomUUID() + '.webp';
  await writeFile(join(UPLOAD_DIR, name), out);
  return `${UPLOAD_URL}/${name}`;
}

// Remove a previously saved image. Ignores URLs that aren't ours.
export async function deleteImage(url) {
  if (typeof url !== 'string' || !url.startsWith(UPLOAD_URL + '/')) return;
  await unlink(join(UPLOAD_DIR, basename(url))).catch(() => {});
}
