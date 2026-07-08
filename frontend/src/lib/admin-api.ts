export interface AdminApiOptions {
  readonly token: string;
  readonly baseUrl?: string;
}

const parseAdminError = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ? `${body.error.code}: ` : '';
    return `${response.status} ${code}${body.error?.message ?? response.statusText}`.trim();
  } catch {
    return `${response.status} ${response.statusText} ${text}`.trim();
  }
};

export async function adminFetch<T>(path: string, options: AdminApiOptions, init: RequestInit = {}): Promise<T> {
  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Bearer ${options.token}`,
  });
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  const response = await fetch(`${options.baseUrl ?? ''}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Admin API failed: ${await parseAdminError(response)}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}
