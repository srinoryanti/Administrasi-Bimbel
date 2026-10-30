import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { get, post, setUnauthorizedHandler } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const d = await get('/auth/me');
      setUser(d.user);
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    refresh();
  }, [refresh]);

  const login = async (identifier, password) => {
    const d = await post('/auth/login', { identifier, password });
    setUser(d.user);
    return d.user;
  };

  const logout = async () => {
    try { await post('/auth/logout', {}); } catch (e) { /* abaikan */ }
    setUser(null);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
export const can = (user, ...roles) => !!user && roles.includes(user.role);
