import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '@/lib/api';

interface AppSettings {
  useClientsModule: boolean;
  requireOtp: boolean;
}

interface AppSettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  refetch: () => void;
}

const defaults: AppSettings = {
  useClientsModule: true, // default ON so existing installs are unaffected
  requireOtp: false,
};

const AppSettingsContext = createContext<AppSettingsContextValue>({
  settings: defaults,
  loading: true,
  refetch: () => {},
});

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaults);
  const [loading, setLoading] = useState(true);

  const fetchSettings = () => {
    api.get('/settings')
      .then((data: Record<string, string>) => {
        setSettings({
          useClientsModule: data.useClientsModule !== 'false', // missing key → true
          requireOtp: data.requireOtp === 'true',
        });
      })
      .catch(() => {
        // If settings can't be fetched (e.g. not SUPER_ADMIN), keep defaults
        setSettings(defaults);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <AppSettingsContext.Provider value={{ settings, loading, refetch: fetchSettings }}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  return useContext(AppSettingsContext);
}
