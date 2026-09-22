/** Reading uploaded files into the shapes the project stores. */

export function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

/** Seconds a sound runs for, or 0 when the browser cannot tell. */
export function audioDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 100) / 100 : 0);
    audio.onerror = () => resolve(0);
    audio.src = src;
  });
}

export function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 100, height: image.naturalHeight || 100 });
    image.onerror = () => resolve({ width: 100, height: 100 });
    image.src = src;
  });
}

/** Rough byte size of a data url's payload. */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  if (comma < 0) return 0;
  const payload = url.slice(comma + 1);
  return url.slice(0, comma).includes(';base64') ? Math.floor((payload.length * 3) / 4) : payload.length;
}
