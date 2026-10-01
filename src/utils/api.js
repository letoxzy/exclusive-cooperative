const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// Uploaded files (avatars, membership photos) are served as static files
// from the server root, not under /api — this strips that suffix so we
// can build image URLs like `${API_ORIGIN}/${avatarPath}`.
export const API_ORIGIN = API_URL.replace(/\/api\/?$/, "");

async function request(path, { method = "GET", body, token, isFormData } = {}) {
  const headers = {};
  if (!isFormData) headers["Content-Type"] = "application/json";
  // The website authenticates via the login cookie, so a real
  // token is only sent when one is actually provided (e.g. mobile).
  if (token && token !== "cookie") headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: "include", // send the login cookie with every request
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || "Something went wrong");
    error.code = data.code;
    error.lockedUntil = data.lockedUntil;
    error.status = res.status;
    throw error;
  }
  return data;
}

export default request;