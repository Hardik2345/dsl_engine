import { createContext, useContext, useState, useEffect } from 'react';

const TenantContext = createContext(null);

const STORAGE_KEY = 'workflow_engine_tenant';
const DEFAULT_TENANT = 'TMC';

export function TenantProvider({ children }) {
  const [tenantId, setTenantId] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || DEFAULT_TENANT;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, tenantId);
  }, [tenantId]);

  return (
    <TenantContext.Provider value={{ tenantId, setTenantId }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}
