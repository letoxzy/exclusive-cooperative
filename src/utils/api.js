const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// Uploaded files (avatars, membership photos) are served as static files
// from the server root, not under /api — this strips that suffix so we
// can build image URLs like `${API_ORIGIN}/${avatarPath}`.
export const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");

async function request(path, { method = "GET", body, token, isFormData } = {}) {
  const headers = {};
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Something went wrong");
  return data;
}

export default request;