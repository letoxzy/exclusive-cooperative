import { createContext, useContext, useState, useEffect } from "react";
import request from "../utils/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on first load by asking the backend who the
  // login cookie belongs to. The token itself is never stored in the
  // browser — it lives in an httpOnly cookie scripts cannot read.
  useEffect(() => {
    request("/auth/me")
      .then((data) => setUser({ ...data, token: "cookie" }))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const data = await request("/auth/login", { method: "POST", body: { email, password } });
    // When email verification is on, the password step only returns a
    // challenge. The member is NOT signed in until verifyLogin succeeds.
    if (data.otpRequired) return data;
    setUser({ ...data, token: "cookie" });
    return data;
  };

  const verifyLogin = async (challengeToken, code) => {
    const data = await request("/auth/login/verify", {
      method: "POST",
      body: { challengeToken, code },
    });
    setUser({ ...data, token: "cookie" });
    return data;
  };

  const resendLoginCode = (challengeToken) =>
    request("/auth/login/resend", { method: "POST", body: { challengeToken } });

  const register = async (fullName, email, password) => {
    const data = await request("/auth/register", {
      method: "POST",
      body: { fullName, email, password },
    });
    setUser({ ...data, token: "cookie" });
    return data;
  };

  const logout = async () => {
    try {
      await request("/auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails, clear local state.
    }
    setUser(null);
  };

  // Re-fetch the latest user record (e.g. after savings balance changes)
  const refreshUser = async () => {
    if (!user) return;
    const data = await request("/auth/me");
    setUser({ ...data, token: "cookie" });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyLogin, resendLoginCode, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
