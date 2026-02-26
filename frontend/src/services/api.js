import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({ baseURL: API_BASE });

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ehr_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ehr_token');
      localStorage.removeItem('ehr_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// =====================
// AUTH
// =====================
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me')
};

// =====================
// RECORDS
// =====================
export const recordsAPI = {
  upload: async (formData) => {
    // Automatically include user's public key and private key for signing
    const user = JSON.parse(localStorage.getItem('ehr_user') || '{}');
    const privateKey = localStorage.getItem('ehr_private_key');
    
    if (user.publicKey) {
      formData.append('patientPublicKey', user.publicKey);
    }
    if (privateKey) {
      formData.append('doctorPrivateKey', privateKey);
    }
    
    return api.post('/records/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  getPatientRecords: (patientId) => api.get(`/records/patient/${patientId}`),
  getRecord: (recordId) => api.get(`/records/${recordId}`),
  download: (recordId) => {
    // Automatically use the stored private key
    const privateKey = localStorage.getItem('ehr_private_key');
    return api.post(`/records/${recordId}/download`, { privateKey }, { responseType: 'blob' });
  }
};

// =====================
// ACCESS DELEGATION
// =====================
export const accessAPI = {
  grant: (data) => api.post('/access/grant', data),
  revoke: (data) => api.post('/access/revoke', data),
  getGrants: (recordId) => api.get(`/access/record/${recordId}`)
};

// =====================
// ADMIN
// =====================
export const adminAPI = {
  getAuditLogs: (limit = 100) => api.get(`/admin/audit-logs?limit=${limit}`),
  getUsers: () => api.get('/admin/users'),
  getSystemStats: () => api.get('/admin/system-stats')
};

// =====================
// CRYPTO
// =====================
export const cryptoAPI = {
  generateKeys: () => api.post('/crypto/generate-keys'),
  sign: (data, privateKey) => api.post('/crypto/sign', { data, private_key: privateKey }),
  verify: (data, signature, publicKey) => api.post('/crypto/verify', { data, signature, public_key: publicKey }),
  health: () => api.get('/crypto/health')
};

export default api;
