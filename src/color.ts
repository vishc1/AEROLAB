export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max ? delta / max : 0, v: max };
}

export function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let rgb = [c, x, 0];
  if (h >= 60 && h < 120) rgb = [x, c, 0]; else if (h >= 120 && h < 180) rgb = [0, c, x]; else if (h >= 180 && h < 240) rgb = [0, x, c]; else if (h >= 240 && h < 300) rgb = [x, 0, c]; else if (h >= 300) rgb = [c, 0, x];
  return rgb.map(channel => Math.round((channel + m) * 255));
}

export function matchesColor(r: number, g: number, b: number, selected: RGB, range: number, sample = rgbToHsv(selected.r, selected.g, selected.b)) {
  if (sample.s > .18) {
    const pixel = rgbToHsv(r, g, b), rawHueGap = Math.abs(pixel.h - sample.h), hueGap = Math.min(rawHueGap, 360 - rawHueGap);
    const hueLimit = 2.5 + range * .17;
    const saturationGap = Math.abs(pixel.s - sample.s), saturationLimit = .12 + range * .003;
    const saturationFloor = Math.max(.12, sample.s * .48);
    const pixelTotal = Math.max(1, r + g + b), sampleTotal = Math.max(1, selected.r + selected.g + selected.b);
    const chromaGap = Math.hypot(r / pixelTotal - selected.r / sampleTotal, g / pixelTotal - selected.g / sampleTotal, b / pixelTotal - selected.b / sampleTotal);
    const chromaLimit = .025 + range * .00115;
    return hueGap <= hueLimit && saturationGap <= saturationLimit && pixel.s >= saturationFloor && chromaGap <= chromaLimit && pixel.v > .035;
  }
  const distance = Math.sqrt(.3 * (r - selected.r) ** 2 + .59 * (g - selected.g) ** 2 + .11 * (b - selected.b) ** 2);
  return distance <= range;
}
