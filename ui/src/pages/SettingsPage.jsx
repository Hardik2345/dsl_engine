import { useState } from 'react';
import { Settings, Save, Trash2, Plus } from 'lucide-react';
import { useTenant } from '../context/TenantContext';
import { useTenants, useDeleteTenant } from '../api/hooks';
import { Card, CardHeader, CardContent, CardTitle, Button, Badge, PageSpinner } from '../components/ui';
import CreateTenantModal from '../components/CreateTenantModal';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { tenantId, setTenantId } = useTenant();
  const { data: tenants, isLoading } = useTenants();
  const deleteTenant = useDeleteTenant();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleDeleteTenant = async (tid) => {
    if (!confirm(`Are you sure you want to deactivate tenant '${tid}'?`)) return;
    
    try {
      await deleteTenant.mutateAsync(tid);
      toast.success(`Tenant '${tid}' deactivated`);
      if (tenantId === tid && tenants?.length > 1) {
        const remaining = tenants.find(t => t.tenantId !== tid);
        if (remaining) setTenantId(remaining.tenantId);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete tenant');
    }
  };

  if (isLoading) return <PageSpinner />;

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">
          Manage tenants and configure your workflow engine
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Tenant Management */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center">
              <Settings className="w-5 h-5 mr-2" />
              Tenant Management
            </CardTitle>
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Tenant
            </Button>
          </CardHeader>
          <CardContent>
            {tenants?.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No tenants found. Create your first tenant to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tenants?.map((tenant) => (
                  <div
                    key={tenant.tenantId}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      tenant.tenantId === tenantId
                        ? 'border-primary-200 bg-primary-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{tenant.tenantId}</span>
                        {tenant.tenantId === tenantId && (
                          <Badge status="active">Current</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{tenant.name}</p>
                      {tenant.description && (
                        <p className="text-xs text-gray-500 mt-1">{tenant.description}</p>
                      )}
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>Currency: {tenant.settings?.currency || 'USD'}</span>
                        <span>Timezone: {tenant.settings?.timezone || 'UTC'}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {tenant.tenantId !== tenantId && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setTenantId(tenant.tenantId)}
                        >
                          Switch
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteTenant(tenant.tenantId)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Version</dt>
                <dd className="font-medium">1.0.0</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Environment</dt>
                <dd className="font-medium">Development</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Active Tenant</dt>
                <dd className="font-medium">{tenantId || 'None'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Total Tenants</dt>
                <dd className="font-medium">{tenants?.length || 0}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <CreateTenantModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}
