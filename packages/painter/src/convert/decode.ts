/**
 * Waits for an image to become drawable.
 *
 * `HTMLImageElement.decode()` gives the cleanest "ready to draw" signal, but in
 * a backgrounded tab it can stay pending forever, so the `load` event is raced
 * against it and either one is enough.
 */
export function whenDecoded(image: HTMLImageElement): Promise<HTMLImageElement> {
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve(image);
      return;
    }
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('[painter] image failed to load')), { once: true });
  });
  if (typeof image.decode !== 'function') return loaded;
  return Promise.race([image.decode().then(() => image), loaded]).catch(() => loaded);
}

/** Creates an image element for `src` and resolves once it can be drawn. */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  const ready = whenDecoded(image);
  image.src = src;
  return ready;
}
