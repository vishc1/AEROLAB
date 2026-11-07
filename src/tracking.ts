export function mapCameraYToTunnel(sourceCenterY: number, sourceHeight: number, targetHeight: number, tunnelHeight: number, padding = 10) {
  const normalizedY = Math.max(0, Math.min(1, sourceCenterY / Math.max(1, sourceHeight - 1)));
  const minCenter = padding + targetHeight / 2;
  const maxCenter = tunnelHeight - padding - targetHeight / 2;
  return minCenter + normalizedY * Math.max(0, maxCenter - minCenter);
}
