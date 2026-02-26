import React, { createContext, useContext, useState, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('ehr_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('ehr_token'));

  const login = useCallback(async (email, password) => {
    const res = await axios.post(`${API_BASE}/auth/login`, { email, password });
    const { token: newToken, user: newUser, privateKey } = res.data;
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('ehr_token', newToken);
    localStorage.setItem('ehr_user', JSON.stringify(newUser));
    // Store private key for automatic cryptographic operations
    if (privateKey) {
      localStorage.setItem('ehr_private_key', privateKey);
    }
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    return newUser;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('ehr_token');
    localStorage.removeItem('ehr_user');
    localStorage.removeItem('ehr_private_key');
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  // Set axios default on mount
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
