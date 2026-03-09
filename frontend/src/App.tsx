import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { QuickLearn } from './components/QuickLearn';
import { Overview } from './pages/Overview';
import { Feed } from './pages/Feed';
import { DocDetail } from './pages/DocDetail';
import { Search } from './pages/Search';
import { Graph } from './pages/Graph';
import { Handoff } from './pages/Handoff';
import { Activity } from './pages/Activity';
import { Forum } from './pages/Forum';
import { Evolution } from './pages/Evolution';
import { Traces } from './pages/Traces';
import { Superseded } from './pages/Superseded';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Playground } from './pages/Playground';
import { Map } from './pages/Map';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { getStats } from './api/oracle';
import { setVaultRepo } from './utils/docDisplay';

// Protected route wrapper
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, authEnabled, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div style={{ padding: 48, textAlign: 'center', color: '#888' }}>Loading...</div>;
  }

  if (authEnabled && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AppContent() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';

  return (
    <>
      {!isLoginPage && <Header />}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Overview /></RequireAuth>} />
        <Route path="/feed" element={<RequireAuth><Feed /></RequireAuth>} />
        <Route path="/doc/:id" element={<RequireAuth><DocDetail /></RequireAuth>} />
        <Route path="/search" element={<RequireAuth><Search /></RequireAuth>} />
        <Route path="/playground" element={<RequireAuth><Playground /></RequireAuth>} />
        <Route path="/map" element={<RequireAuth><Map /></RequireAuth>} />
        <Route path="/graph" element={<RequireAuth><Graph /></RequireAuth>} />
        <Route path="/graph3d" element={<Navigate to="/graph" replace />} />
        <Route path="/handoff" element={<RequireAuth><Handoff /></RequireAuth>} />
        <Route path="/activity" element={<RequireAuth><Activity /></RequireAuth>} />
        <Route path="/forum" element={<RequireAuth><Forum /></RequireAuth>} />
        <Route path="/evolution" element={<RequireAuth><Evolution /></RequireAuth>} />
        <Route path="/traces" element={<RequireAuth><Traces /></RequireAuth>} />
        <Route path="/traces/:id" element={<RequireAuth><Traces /></RequireAuth>} />
        <Route path="/superseded" element={<RequireAuth><Superseded /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
      </Routes>
      {!isLoginPage && <QuickLearn />}
    </>
  );
}

function App() {
  useEffect(() => {
    getStats().then(stats => {
      if (stats.vault_repo) setVaultRepo(stats.vault_repo);
    }).catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
