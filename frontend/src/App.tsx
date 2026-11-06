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
import PlannerPage from './pages/Planner';
import PppoeDevicePage from './pages/PppoeDevice';
import ServiceOrderPage from './pages/ServiceOrder';
import ServiceOrdersPage from './pages/ServiceOrders';
import UnifiPage from './pages/Unifi';
import UnifiControllerPage from './pages/UnifiController';
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
  const osAccess = ['os.view_all', 'os.manage', 'os.execute'].some((p) => can(p));
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        {can('wireguard.view') && <Route path="wireguard" element={<WireguardPage />} />}
        {can('clients.view') && <Route path="clientes" element={<ClientsPage />} />}
        <Route path="equipamentos" element={<DevicesPage />} />
        <Route path="equipamentos/:id" element={<DeviceDetailPage />} />
        {can('unifi.view') && <Route path="unifi" element={<UnifiPage />} />}
        {can('unifi.view') && <Route path="unifi/:id" element={<UnifiControllerPage />} />}
        {can('pppoe.view') && <Route path="pppoe" element={<PppoePage />} />}
        {can('pppoe.view') && <Route path="pppoe/:id" element={<PppoeDevicePage />} />}
        {osAccess && <Route path="os" element={<ServiceOrdersPage />} />}
        {osAccess && <Route path="os/:id" element={<ServiceOrderPage />} />}
        {can('planner.manage') && <Route path="planejamento" element={<PlannerPage />} />}
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
