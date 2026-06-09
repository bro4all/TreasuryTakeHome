import { describe, expect, it } from 'vitest';
import {
  contrastBounds,
  grayscaleAndStretch,
  MAX_DIMENSION,
  MIN_DIMENSION,
  targetScale
} from './preprocess';

describe('targetScale', () => {
  it('leaves well-sized images alone', () => {
    expect(targetScale(1500, 1200)).toBe(1);
  });

  it('downscales oversized images to the cap', () => {
    expect(targetScale(4000, 3000)).toBeCloseTo(MAX_DIMENSION / 4000);
  });

  it('upscales small images to the floor', () => {
    expect(targetScale(500, 400)).toBeCloseTo(MIN_DIMENSION / 400);
  });

  it('never upscales past the long-edge cap', () => {
    // Extremely elongated image: short edge wants 2.5x but long edge limits it.
    const scale = targetScale(1900, 400);
    expect(scale).toBeCloseTo(MAX_DIMENSION / 1900);
  });

  it('handles degenerate sizes', () => {
    expect(targetScale(0, 0)).toBe(1);
  });
});

describe('contrastBounds', () => {
  it('finds percentile bounds of a spread histogram', () => {
    const values = new Uint8ClampedArray(1000);
    for (let i = 0; i < values.length; i += 1) values[i] = 60 + (i % 100); // 60..159
    const { low, high } = contrastBounds(values);
    expect(low).toBeGreaterThanOrEqual(60);
    expect(high).toBeLessThanOrEqual(159);
    expect(high).toBeGreaterThan(low);
  });

  it('falls back to the full range for flat images', () => {
    const values = new Uint8ClampedArray(100).fill(128);
    expect(contrastBounds(values)).toEqual({ low: 0, high: 255 });
  });
});

describe('grayscaleAndStretch', () => {
  it('stretches a low-contrast image toward full range', () => {
    // Two-pixel image: dark gray and light gray.
    const rgba = new Uint8ClampedArray([100, 100, 100, 255, 150, 150, 150, 255]);
    grayscaleAndStretch(rgba);
    expect(rgba[0]).toBeLessThan(30); // dark pixel pushed toward black
    expect(rgba[4]).toBeGreaterThan(225); // light pixel pushed toward white
    expect(rgba[3]).toBe(255); // alpha untouched
  });

  it('produces equal RGB channels (grayscale)', () => {
    const rgba = new Uint8ClampedArray([200, 50, 10, 255, 10, 200, 50, 255]);
    grayscaleAndStretch(rgba);
    expect(rgba[0]).toBe(rgba[1]);
    expect(rgba[1]).toBe(rgba[2]);
  });
});
