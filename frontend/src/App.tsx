import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AreaRoute } from './components/AreaRoute';
import { useAuthStore } from './lib/auth-store';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { GoogleCallbackPage } from './pages/GoogleCallbackPage';
import { WelcomePage } from './pages/WelcomePage';
import { CompanyDashboard } from './pages/CompanyDashboard';
import { StoreDashboard } from './pages/StoreDashboard';

function ForbiddenPage() { return <main className="simple-state"><h1>403</h1><p>You do not have access to this workspace.</p><a href="/login">Return to sign in</a></main>; }
function NotFoundPage() { return <main className="simple-state"><h1>404</h1><p>This page does not exist.</p><a href="/login">Return to sign in</a></main>; }

function AuthBootstrap() {
  const restore = useAuthStore((state) => state.restore);
  const location = useLocation();
  useEffect(() => { void restore(); }, [restore]);
  return <Routes location={location}>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
    <Route path="/company" element={<AreaRoute area="COMPANY"><CompanyDashboard /></AreaRoute>} />
    <Route path="/company/*" element={<AreaRoute area="COMPANY"><CompanyDashboard /></AreaRoute>} />
    <Route path="/store" element={<AreaRoute area="STORE"><StoreDashboard /></AreaRoute>} />
    <Route path="/store/*" element={<AreaRoute area="STORE"><StoreDashboard /></AreaRoute>} />
    <Route path="/app" element={<ProtectedRoute><WelcomePage /></ProtectedRoute>} />
    <Route path="/403" element={<ForbiddenPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}

export default function App() {
  return <AuthBootstrap />;
}
