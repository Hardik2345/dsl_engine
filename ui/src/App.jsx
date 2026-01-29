import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import WorkflowsPage from './pages/WorkflowsPage';
import WorkflowDetailPage from './pages/WorkflowDetailPage';
import WorkflowRunsPage from './pages/WorkflowRunsPage';
import RunDetailPage from './pages/RunDetailPage';
import InsightsPage from './pages/InsightsPage';
import SettingsPage from './pages/SettingsPage';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/workflows" replace />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
        <Route path="/workflows/:workflowId/runs" element={<WorkflowRunsPage />} />
        <Route path="/workflows/:workflowId/runs/:runId" element={<RunDetailPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  );
}

export default App;
