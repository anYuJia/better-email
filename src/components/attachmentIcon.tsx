import type { ReactNode } from 'react';

const assetNameByExtension: Record<string, string> = {
  '7z': '7z',
  ai: 'ai',
  apk: 'apk',
  c: 'c',
  cpp: 'cpp',
  css: 'css',
  dmg: 'dmg',
  doc: 'docx',
  docm: 'docx',
  docx: 'docx',
  exe: 'exe',
  gif: 'gif',
  gz: 'zip',
  heic: 'heic',
  heif: 'heic',
  htm: 'html',
  html: 'html',
  java: 'java',
  jpeg: 'jpg',
  jpg: 'jpg',
  js: 'js',
  key: 'pptx',
  md: 'md',
  mp3: 'mp3',
  mp4: 'mp4',
  numbers: 'xlsx',
  pdf: 'pdf',
  png: 'png',
  ppt: 'pptx',
  pptm: 'pptx',
  pptx: 'pptx',
  psd: 'psd',
  py: 'py',
  rar: 'rar',
  rtf: 'rtf',
  svg: 'svg',
  tar: 'zip',
  tgz: 'zip',
  ts: 'ts',
  txt: 'txt',
  webp: 'webp',
  xls: 'xlsx',
  xlsm: 'xlsx',
  xlsx: 'xlsx',
  zip: 'zip',
};

const assetNameByMimeType: Record<string, string> = {
  'application/illustrator': 'ai',
  'application/javascript': 'js',
  'application/java-archive': 'java',
  'application/pdf': 'pdf',
  'application/rtf': 'rtf',
  'application/typescript': 'ts',
  'application/vnd.adobe.photoshop': 'psd',
  'application/vnd.android.package-archive': 'apk',
  'application/vnd.apple.keynote': 'pptx',
  'application/vnd.apple.numbers': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.ms-powerpoint': 'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/x-7z-compressed': '7z',
  'application/x-apple-diskimage': 'dmg',
  'application/x-rar-compressed': 'rar',
  'application/x-zip-compressed': 'zip',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/vnd.adobe.photoshop': 'psd',
  'image/webp': 'webp',
  'text/css': 'css',
  'text/html': 'html',
  'text/javascript': 'js',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/rtf': 'rtf',
  'video/mp4': 'mp4',
};

function filenameExtension(filename: string) {
  const basename = filename.trim().split(/[\\/]/).pop() ?? '';
  return basename.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() ?? '';
}

export function attachmentIconAsset(filename: string, mimeType = '') {
  const extensionAsset = assetNameByExtension[filenameExtension(filename)];
  const mimeAsset = assetNameByMimeType[mimeType.toLowerCase().split(';', 1)[0].trim()];
  const assetName = extensionAsset ?? mimeAsset;
  return assetName ? `/attachment-icons/${assetName}.png` : null;
}

type AttachmentIconProps = {
  filename: string;
  mimeType?: string;
  className?: string;
  fallback?: ReactNode;
};

export function AttachmentIcon({ filename, mimeType = '', className, fallback = null }: AttachmentIconProps) {
  const src = attachmentIconAsset(filename, mimeType);
  if (!src) return fallback;
  return <img className={className} src={src} alt="" aria-hidden="true" decoding="async" draggable={false} />;
}
