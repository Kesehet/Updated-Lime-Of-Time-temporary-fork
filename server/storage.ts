// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { ENV } from "./_core/env";

type StorageConfig = { baseUrl: string; apiKey: string };

function getStorageConfig(): StorageConfig {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Storage proxy credentials missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(baseUrl: string, relKey: string, apiKey: string): Promise<string> {
  const downloadApiUrl = new URL("v1/storage/downloadUrl", ensureTrailingSlash(baseUrl));
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string,
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`,
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const { baseUrl, apiKey } = getStorageConfig();
  const key = normalizeKey(relKey);
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

/**
 * Delete a file from storage by its relative key or full URL.
 * Extracts the storage key from CloudFront/CDN URLs automatically.
 * Silently ignores errors (e.g. if the file is already gone or the endpoint is unavailable).
 */
export async function storageDelete(relKeyOrUrl: string): Promise<void> {
  try {
    const { baseUrl, apiKey } = getStorageConfig();
    // Extract relative key from full URLs (CloudFront or proxy URLs)
    let key = relKeyOrUrl;
    if (relKeyOrUrl.startsWith("http://") || relKeyOrUrl.startsWith("https://")) {
      try {
        const parsed = new URL(relKeyOrUrl);
        // Remove leading slash from pathname
        key = parsed.pathname.replace(/^\/+/, "");
      } catch {
        key = relKeyOrUrl;
      }
    }
    key = normalizeKey(key);
    const deleteUrl = new URL("v1/storage/delete", ensureTrailingSlash(baseUrl));
    deleteUrl.searchParams.set("path", key);
    await fetch(deleteUrl, {
      method: "DELETE",
      headers: buildAuthHeaders(apiKey),
    });
  } catch {
    // Silently ignore — storage cleanup is best-effort
  }
}

/**
 * Delete multiple files from storage in parallel.
 * Silently ignores individual failures.
 */
export async function storageDeleteMany(relKeysOrUrls: (string | null | undefined)[]): Promise<void> {
  const valid = relKeysOrUrls.filter((u): u is string => !!u && u.startsWith("http"));
  await Promise.allSettled(valid.map((u) => storageDelete(u)));
}
