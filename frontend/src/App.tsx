import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import AuditPage from './pages/Audit';
import AuditDevicePage from './pages/AuditDevice';
import ChangePasswordPage from './pages/ChangePassword';
import ClientsPage from './pages/Clients';
import DashboardPage from './pages/Dashboard';
import DeviceDetailPage from './pages/DeviceDetail';
import DevicesPage from './pages/Devices';
import LoginPage from './pages/Login';
import NotificationsPage from './pages/Notifications';
import PppoePage from './pages/Pppoe';
import PppoeDevicePage from './pages/PppoeDevice';
import UsersPage from './pages/Users';
import WireguardPage from './pages/Wireguard';

export default function App() {
  const { user, loading, can } = useAuth();
  if (loading) return <Spinner />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (user.mustChangePassword) return <ChangePasswordPage forced />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        {can('wireguard.view') && <Route path="wireguard" element={<WireguardPage />} />}
        {can('clients.view') && <Route path="clientes" element={<ClientsPage />} />}
        <Route path="equipamentos" element={<DevicesPage />} />
        <Route path="equipamentos/:id" element={<DeviceDetailPage />} />
        {can('pppoe.view') && <Route path="pppoe" element={<PppoePage />} />}
        {can('pppoe.view') && <Route path="pppoe/:id" element={<PppoeDevicePage />} />}
        {can('audit.view') && <Route path="auditoria" element={<AuditPage />} />}
        {can('audit.view') && <Route path="auditoria/:key" element={<AuditDevicePage />} />}
        {can('users.manage') && <Route path="usuarios" element={<UsersPage />} />}
        {can('notifications.manage') && <Route path="notificacoes" element={<NotificationsPage />} />}
        <Route path="senha" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
