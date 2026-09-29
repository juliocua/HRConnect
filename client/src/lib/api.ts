import axios from 'axios';

const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? ''}/api`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hrc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear token and reload to login (but not for the auth check itself)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const isAuthCheck = err.config?.url?.includes('/auth/me');
      const alreadyOnLogin = window.location.pathname === '/login';
      if (!isAuthCheck && !alreadyOnLogin) {
        localStorage.removeItem('hrc_token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
