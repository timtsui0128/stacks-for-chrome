const icons = new Map();

async function bitmap(url) {
  if (url.startsWith("data:image/png;base64,")) {
    const bytes = Uint8Array.from(atob(url.slice(22)), char => char.charCodeAt(0));
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error("Cached favicon unavailable");
  return createImageBitmap(await response.blob());
}

async function png(canvas) {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export async function stableSiteIcon(api, key, cachedUrl, preferSaved = false) {
  const { siteIcons = {} } = await api.storage.local.get("siteIcons");
  if (preferSaved && siteIcons[key]) return siteIcons[key];
  const candidates = [cachedUrl];
  if (key === "canvas.manchester.ac.uk") {
    const packaged = api.runtime.getURL("icons/sites/canvas.png");
    if (preferSaved) candidates.unshift(packaged); else candidates.push(packaged);
  }
  for (const candidate of candidates) {
    try {
      const source = await bitmap(candidate);
      const canvas = new OffscreenCanvas(32, 32);
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, 32, 32);
      source.close();
      const pixels = context.getImageData(0, 0, 32, 32).data;
      if (!pixels.some((byte, index) => index % 4 === 3 && byte)) continue;
      const image = await png(canvas);
      if (siteIcons[key] !== image) {
        siteIcons[key] = image;
        const entries = Object.entries(siteIcons);
        await api.storage.local.set({ siteIcons: Object.fromEntries(entries.slice(-100)) });
      }
      return image;
    } catch { /* Keep the last website logo when Chrome's cache is unavailable. */ }
  }
  return siteIcons[key] || cachedUrl;
}

// Run in the service worker: hidden control tabs may defer DOM image decoding.
// Only Chrome's extension-local favicon cache is fetched, never a remote URL.
export async function badgedIcon(url, fill, collapsed) {
  const key = `${url}:${fill}:${collapsed}`;
  if (!icons.has(key)) {
    if (icons.size >= 32) icons.clear();
    const drawing = (async () => {
      const source = await bitmap(url);
      const canvas = new OffscreenCanvas(32, 32);
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, 32, 32);
      source.close();
      context.beginPath();
      context.arc(26, 26, 5, 0, Math.PI * 2);
      context.fillStyle = collapsed ? "#fff" : fill;
      context.fill();
      context.strokeStyle = "#fff";
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = fill;
      context.lineWidth = 1.5;
      context.stroke();
      return png(canvas);
    })().catch(() => { icons.delete(key); return url; });
    icons.set(key, drawing);
  }
  return icons.get(key);
}
