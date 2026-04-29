import axios from 'axios';
import { getCorrelationId } from '../utils/logger';

const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['x-correlation-id'] = getCorrelationId();
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'https://api.amsterdamhostel.cloud';
export const AI_SERVICE_URL =
  import.meta.env.VITE_AI_SERVICE_URL || 'https://ai.amsterdamhostel.cloud';
export const SIGNALING_WS_URL =
  import.meta.env.VITE_SIGNALING_WS_URL ||
  'wss://api.amsterdamhostel.cloud/signaling';

export default api;
