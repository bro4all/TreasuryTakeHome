/**
 * Light image preprocessing to make imperfect label photos (uneven lighting,
 * low contrast, small originals) more readable for Tesseract. Heavier steps
 * like deskewing are deliberately out of scope; Tesseract applies its own
 * binarization and the goal here is to feed it a cleaner starting point.
 *
 * The pixel math lives in pure functions so it can be unit-tested in Node.
 */

/** Longest edge after preprocessing; larger photos are downscaled to this. */
export const MAX_DIMENSION = 2000;
/** Shortest edge floor; small images are upscaled so glyphs have enough pixels. */
export const MIN_DIMENSION = 1000;

/** Scale factor that keeps the image within [MIN_DIMENSION, MAX_DIMENSION]. */
export function targetScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge > MAX_DIMENSION) return MAX_DIMENSION / longEdge;
  if (shortEdge < MIN_DIMENSION) {
    // Never upscale beyond the long-edge cap.
    return Math.min(MIN_DIMENSION / shortEdge, MAX_DIMENSION / longEdge);
  }
  return 1;
}

/** Luminance histogram percentile bounds used for contrast stretching. */
export function contrastBounds(
  luminances: Uint8ClampedArray | Uint8Array | number[],
  lowPercentile = 0.02,
  highPercentile = 0.98
): { low: number; high: number } {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < luminances.length; i += 1) {
    histogram[luminances[i]] += 1;
  }

  const total = luminances.length;
  let low = 0;
  let high = 255;
  let cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= total * lowPercentile) {
      low = value;
      break;
    }
  }
  cumulative = 0;
  for (let value = 255; value >= 0; value -= 1) {
    cumulative += histogram[value];
    if (cumulative >= total * (1 - highPercentile)) {
      high = value;
      break;
    }
  }

  return high > low ? { low, high } : { low: 0, high: 255 };
}

/**
 * Converts RGBA pixels to grayscale and stretches contrast in place so the
 * darkest text approaches black and the paper approaches white.
 */
export function grayscaleAndStretch(rgba: Uint8ClampedArray): void {
  const pixelCount = rgba.length / 4;
  const luminances = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    luminances[i] = Math.round(
      0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]
    );
  }

  const { low, high } = contrastBounds(luminances);
  const range = high - low;

  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const stretched = Math.max(0, Math.min(255, Math.round(((luminances[i] - low) * 255) / range)));
    rgba[offset] = stretched;
    rgba[offset + 1] = stretched;
    rgba[offset + 2] = stretched;
  }
}

export interface PreprocessedImage {
  canvas: HTMLCanvasElement;
  steps: string[];
}

/** Loads an image URL and returns a cleaned-up canvas ready for OCR. */
export async function preprocessImage(imageUrl: string): Promise<PreprocessedImage> {
  const image = await loadImage(imageUrl);
  const scale = targetScale(image.naturalWidth, image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas 2D context unavailable; cannot preprocess image.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  grayscaleAndStretch(imageData.data);
  context.putImageData(imageData, 0, 0);

  const steps = ['grayscale', 'contrast stretch'];
  if (scale > 1) steps.unshift(`upscaled ${Math.round(scale * 100)}%`);
  if (scale < 1) steps.unshift(`downscaled ${Math.round(scale * 100)}%`);

  return { canvas, steps };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image for OCR.'));
    image.src = url;
  });
}
