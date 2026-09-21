export type LatLng = { lat: number; lng: number };

/** Google's 256px world projection, used to nudge the camera by screen pixels. */
function latToWorldY(lat: number): number {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return 128 - 0.5 * Math.log((1 + siny) / (1 - siny)) * (128 / Math.PI);
}

function worldYToLat(y: number): number {
  const t = ((128 - y) * Math.PI) / 128;
  return ((2 * Math.atan(Math.exp(t)) - Math.PI / 2) * 180) / Math.PI;
}

/**
 * Returns the center that puts `target` `pixelsY` above the middle of the
 * viewport — so a bottom sheet never covers the pin you just tapped.
 */
export function offsetCenter(target: LatLng, zoom: number, pixelsY: number): LatLng {
  if (!pixelsY) return target;
  const scale = Math.pow(2, zoom);
  return {
    lat: worldYToLat(latToWorldY(target.lat) + pixelsY / scale),
    lng: target.lng,
  };
}

function shortestLngDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const running = new WeakMap<google.maps.Map, number>();

export function cancelCameraAnimation(map: google.maps.Map) {
  const frame = running.get(map);
  if (frame !== undefined) {
    cancelAnimationFrame(frame);
    running.delete(map);
  }
}

/** Google-Maps-style glide: center and zoom ease together instead of snapping. */
export function animateCamera(
  map: google.maps.Map,
  target: LatLng,
  zoom: number,
  { duration = 700, offsetY = 0 }: { duration?: number; offsetY?: number } = {}
) {
  const startCenter = map.getCenter();
  const startZoom = map.getZoom();
  const endCenter = offsetCenter(target, zoom, offsetY);

  if (!startCenter || startZoom === undefined) {
    map.moveCamera({ center: endCenter, zoom });
    return;
  }

  cancelCameraAnimation(map);

  const from = { lat: startCenter.lat(), lng: startCenter.lng(), zoom: startZoom };
  const lngDelta = shortestLngDelta(from.lng, endCenter.lng);
  const startedAt = performance.now();

  const step = (now: number) => {
    const t = Math.min(1, (now - startedAt) / duration);
    const e = easeInOutCubic(t);
    map.moveCamera({
      center: {
        lat: from.lat + (endCenter.lat - from.lat) * e,
        lng: from.lng + lngDelta * e,
      },
      zoom: from.zoom + (zoom - from.zoom) * e,
    });
    if (t < 1) {
      running.set(map, requestAnimationFrame(step));
    } else {
      running.delete(map);
    }
  };

  running.set(map, requestAnimationFrame(step));
}
