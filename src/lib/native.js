/** Capacitor (Android APK) integration. Everything here is a no-op on the web. */
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

const blobToBase64 = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); });

/** Write a file into the app cache and open the Android share sheet (save to Files/Drive, e-mail, WhatsApp…). */
export async function saveAndShare(blob, filename, title) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const res = await Filesystem.writeFile({ path: `MedicalTome/${filename}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true });
  await Share.share({ title, url: res.uri, dialogTitle: title });
}

export async function shareText(title, text) {
  const { Share } = await import('@capacitor/share');
  await Share.share({ title, text, dialogTitle: title });
}
