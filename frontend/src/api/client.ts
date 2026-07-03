export class ApiError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // FormData bodies (file uploads) must NOT get a manual Content-Type — fetch sets the
  // multipart boundary itself, and overriding it here would break the upload.
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: isFormData ? options.headers || {} : { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    let body: { error?: { code: string; message: string; details: Record<string, unknown> } } = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    if (body.error) {
      throw new ApiError(body.error.code, body.error.message, body.error.details);
    }
    throw new ApiError("http_error", `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
