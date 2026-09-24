import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuthStore } from './lib/auth-store';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { WelcomePage } from './pages/WelcomePage';

function AuthBootstrap() {
  const restore = useAuthStore((state) => state.restore);
  const location = useLocation();
  useEffect(() => { void restore(); }, [restore]);
  return <Routes location={location}>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/app" element={<ProtectedRoute><WelcomePage /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>;
}

export default function App() {
  return <AuthBootstrap />;
}
