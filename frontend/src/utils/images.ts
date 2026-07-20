import type { ImageRecord } from '../types';

export function selectPrimaryImage(images: Array<ImageRecord | undefined>) {
  return images.find(image => image?.role === 'result_image') || images.find(Boolean);
}

export function imageDisplayPath(image?: ImageRecord) {
  return image?.preview_path || image?.original_path || image?.thumb_path || '';
}

export function imageThumbnailPath(image?: ImageRecord) {
  return image?.thumb_path || image?.preview_path || '';
}

export function imageHeroPath(image?: ImageRecord) {
  return image?.preview_path || image?.original_path || image?.thumb_path || '';
}

export function imageOriginalPath(image?: ImageRecord) {
  return image?.original_path || image?.preview_path || image?.thumb_path || '';
}

export function downloadFileName(title: string, path?: string | null) {
  const extension = path?.split('?')[0]?.split('#')[0]?.split('.').pop() || 'png';
  const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\u3400-\u4dbf]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
  return `${safeTitle}.${extension}`;
}

/**
 * 2026-07-20 主人拍: 用户从 bip 下载图片时, 不论服务端存的啥格式 (webp/png/jpg),
 * 浏览器一律存为 .jpg. 走 <img> + canvas + toBlob('image/jpeg', 0.95), 同源 OK.
 */
export async function downloadImageAsJpeg(title: string, src: string): Promise<void> {
  const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\u3400-\u4dbf]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
  const fileName = `${safeTitle}.jpg`;
  // 1) 加载图片
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
  // 2) 画到 canvas
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  // 透明背景 (PNG/WebP) → JPG 白底, 避免黑底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  // 3) toBlob jpeg q=0.95
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.95);
  });
  // 4) trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
