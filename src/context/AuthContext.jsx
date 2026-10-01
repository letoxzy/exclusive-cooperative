import { createContext, useContext, useState, useEffect } from "react";
import request from "../utils/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on first load
  useEffect(() => {
    const stored = localStorage.getItem("exclusive_user");
    if (stored) setUser(JSON.parse(stored));
    setLoading(false);
  }, []);

  const persist = (userData) => {
    setUser(userData);
    localStorage.setItem("exclusive_user", JSON.stringify(userData));
  };

  const login = async (email, password) => {
    const data = await request("/auth/login", { method: "POST", body: { email, password } });
    persist(data);
    return data;
  };

  const register = async (fullName, email, password) => {
    const data = await request("/auth/register", {
      method: "POST",
      body: { fullName, email, password },
    });
    persist(data);
    return data;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("exclusive_user");
  };

  // Re-fetch the latest user record (e.g. after savings balance changes)
  const refreshUser = async () => {
    if (!user) return;
    const data = await request("/auth/me", { token: user.token });
    persist({ ...data, token: user.token });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
