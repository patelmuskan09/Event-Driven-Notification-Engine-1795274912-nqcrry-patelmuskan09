import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Radio,
  Send,
  Layers,
  BarChart3,
  RefreshCw,
  Server,
  Inbox,
  CheckCircle2,
  FileText,
  Sparkles,
  Sliders,
  Search,
  ExternalLink,
  LogIn,
  LogOut,
  Eye,
} from 'lucide-react';

interface NotificationItem {
  id: string;
  eventId: string;
  userId: string;
  eventType: string;
  category: string;
  priority: string;
  channel: string;
  status: string;
  recipientAddress: string;
  subject?: string;
  renderedBody: string;
  language: string;
  costInr: number;
  provider: string;
  createdAt: string;
  complianceLog?: any;
}

interface AnalyticsSnapshot {
  overall_delivery_rate: string;
  critical_delivery_rate: string;
  p99_critical_latency_ms: number;
  open_rate: string;
  click_through_rate: string;
  failure_rate: string;
  total_events_processed: number;
  total_delivered: number;
  total_read: number;
  total_failed: number;
  dnd_violations: number;
}

interface OptOutAnalytics {
  dnd_blocked_total: number;
  dnd_violations_total: number;
  opt_out_rate_percent: number;
  frequency_cap_hits: number;
  quiet_hours_queued: number;
  total_cost_inr: number;
}

interface HealthSummary {
  status: string;
  provider_mode: string;
  components: Record<string, string>;
  component_modes: Record<string, string>;
}

const SAMPLE_PAYLOADS: Record<string, { sourceSystem: string; payload: Record<string, unknown> }> = {
  'TXNX-001': {
    sourceSystem: 'TRADING_ENGINE',
    payload: {
      order_id: 'ORD-100001',
      symbol: 'RELIANCE',
      quantity: 50,
      price: 2950.5,
      total_amount: 147525.0,
      execution_time: new Date().toISOString(),
      exchange: 'NSE',
    },
  },
  'RISK-001': {
    sourceSystem: 'RMS',
    payload: {
      account_id: 'ACC-USR-894120',
      required_margin: 250000,
      available_margin: 180000,
      shortfall: 70000,
      deadline_time: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    },
  },
};

export default function App() {
  const [activeTab, setActiveTab] = useState<
    'cockpit' | 'events' | 'simulations' | 'compliance' | 'providers' | 'dlq' | 'docs'
  >('cockpit');

  const [accessToken, setAccessToken] = useState<string>('');
  const [refreshToken, setRefreshToken] = useState<string>('');
  const [authRole, setAuthRole] = useState<string>('');
  const [loginEmail, setLoginEmail] = useState('admin@brokerage.local');
  const [loginPassword, setLoginPassword] = useState(
    import.meta.env.DEV ? 'admin-local-dev' : ''
  );
  const [authError, setAuthError] = useState<string>('');

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [optOutStats, setOptOutStats] = useState<OptOutAnalytics | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [providersHealth, setProvidersHealth] = useState<any[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<any[]>([]);
  const [dlqEntries, setDlqEntries] = useState<any[]>([]);

  const [selectedEventType, setSelectedEventType] = useState('RISK-001');
  const [targetUserId, setTargetUserId] = useState('USR-894120');
  const [selectedLang, setSelectedLang] = useState('en');
  const [eventSourceSystem, setEventSourceSystem] = useState('RMS');
  const [eventPayloadJson, setEventPayloadJson] = useState(
    JSON.stringify(SAMPLE_PAYLOADS['RISK-001'].payload, null, 2)
  );
  const [simulationLog, setSimulationLog] = useState<string>('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [selectedNotif, setSelectedNotif] = useState<any | null>(null);

  const performLogin = useCallback(async (email: string, password: string) => {
    setAuthError('');
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.message || 'Sign-in failed');
        return false;
      }
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      setAuthRole(data.role);
      return true;
    } catch (err: any) {
      setAuthError(err.message || 'Network error during login');
      return false;
    }
  }, []);

  // Auto-authenticate in local dev preview using configured dev session
  useEffect(() => {
    if (!accessToken && import.meta.env.DEV) {
      void performLogin('admin@brokerage.local', 'admin-local-dev');
    }
  }, [accessToken, performLogin]);

  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(options.headers || {});
      if (accessToken) {
        headers.set('Authorization', `Bearer ${accessToken}`);
      }
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      let res = await fetch(url, { ...options, headers });
      if (res.status === 401 && refreshToken) {
        const refRes = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (refRes.ok) {
          const refData = await refRes.json();
          setAccessToken(refData.accessToken);
          setRefreshToken(refData.refreshToken);
          setAuthRole(refData.role);
          headers.set('Authorization', `Bearer ${refData.accessToken}`);
          res = await fetch(url, { ...options, headers });
        } else {
          setAccessToken('');
          setRefreshToken('');
          setAuthRole('');
        }
      }
      return res;
    },
    [accessToken, refreshToken]
  );

  const refreshData = useCallback(async () => {
    try {
      const healthRes = await fetch('/health').then((r) => r.json()).catch(() => null);
      if (healthRes) setHealth(healthRes);

      if (!accessToken) return;

      const [notifsRes, statsRes, optRes, alertsRes, provRes, dlqRes] = await Promise.all([
        apiFetch('/api/v1/notifications?limit=30').then((r) => r.json()).catch(() => ({ notifications: [] })),
        apiFetch('/api/v1/analytics/delivery-rates').then((r) => r.json()).catch(() => null),
        apiFetch('/api/v1/analytics/opt-out-trends').then((r) => r.json()).catch(() => null),
        apiFetch('/api/v1/alerts').then((r) => r.json()).catch(() => ({ alerts: [] })),
        apiFetch('/api/v1/providers/health')
          .then((r) => r.json())
          .catch(() => ({ providers: [], circuit_breakers: [] })),
        apiFetch('/api/v1/dlq').then((r) => r.json()).catch(() => ({ entries: [] })),
      ]);

      if (notifsRes?.notifications) setNotifications(notifsRes.notifications);
      if (statsRes && !statsRes.error) setAnalytics(statsRes);
      if (optRes && !optRes.error) setOptOutStats(optRes);
      if (alertsRes?.alerts) setAlerts(alertsRes.alerts);
      if (provRes?.providers) setProvidersHealth(provRes.providers);
      if (provRes?.circuit_breakers) setCircuitBreakers(provRes.circuit_breakers);
      if (dlqRes?.entries) setDlqEntries(dlqRes.entries);
    } catch (e) {
      console.error('Failed to poll dashboard data', e);
    }
  }, [accessToken, apiFetch]);

  useEffect(() => {
    void refreshData();
    const interval = setInterval(() => void refreshData(), 3000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // Fetch schema-valid sample payload when selectedEventType changes
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void (async () => {
      try {
        const res = await apiFetch(`/api/v1/events/sample/${selectedEventType}`);
        if (res.ok && active) {
          const data = await res.json();
          setEventSourceSystem(data.sourceSystem);
          setEventPayloadJson(JSON.stringify(data.payload, null, 2));
        }
      } catch {
        // Keep current payload on network hiccup
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedEventType, accessToken, apiFetch]);

  const handleLogout = async () => {
    if (refreshToken) {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    setAccessToken('');
    setRefreshToken('');
    setAuthRole('');
  };

  // Send single schema-validated event
  const handleTriggerEvent = async () => {
    try {
      const parsedPayload = JSON.parse(eventPayloadJson);
      const res = await apiFetch('/api/v1/events', {
        method: 'POST',
        body: JSON.stringify({
          eventType: selectedEventType,
          userId: targetUserId,
          sourceSystem: eventSourceSystem,
          idempotencyKey: `${selectedEventType}:${targetUserId}:${Date.now()}`,
          metadata: { targetLanguage: selectedLang },
          payload: parsedPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSimulationLog(`[REJECTED ${res.status}] ${data.error}: ${data.details || data.message}`);
        return;
      }
      setSimulationLog(
        `[EVENT INGESTED] ${selectedEventType} -> ID: ${data.notification_id} (Status: ${data.status}, Channels: ${
          data.channels_targeted?.join(', ') || 'none'
        })`
      );
      void refreshData();
    } catch (err: any) {
      setSimulationLog(`[ERROR] ${err.message}`);
    }
  };

  // Load clean multi-category demonstration traffic via real API
  const handleRunQuickSampleBatch = async () => {
    setIsSimulating(true);
    try {
      const types = ['RISK-001', 'TXNX-001', 'SIPX-001', 'MKTX-001', 'REGX-003'];
      for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const sampleRes = await apiFetch(`/api/v1/events/sample/${type}`);
        if (!sampleRes.ok) continue;
        const sample = await sampleRes.json();
        await apiFetch('/api/v1/events', {
          method: 'POST',
          body: JSON.stringify({
            eventType: type,
            userId: `USR-DEMO-${100 + i}`,
            sourceSystem: sample.sourceSystem,
            idempotencyKey: `DEMO:${type}:${Date.now()}:${i}`,
            metadata: { targetLanguage: i === 4 ? 'hi' : 'en' },
            payload: sample.payload,
          }),
        });
      }
      void refreshData();
    } finally {
      setIsSimulating(false);
    }
  };

  const runSimulation = async (endpoint: string, name: string) => {
    setIsSimulating(true);
    setSimulationLog(`[RUNNING] Starting ${name}...`);
    try {
      const res = await apiFetch(`/api/v1/simulations/${endpoint}`, {
        method: endpoint === 'compliance-audit' ? 'GET' : 'POST',
      });
      const data = await res.json();
      setSimulationLog(`[COMPLETED] ${name}:\n${JSON.stringify(data, null, 2)}`);
      void refreshData();
    } catch (err: any) {
      setSimulationLog(`[FAILED] ${name}: ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  const toggleProviderFailure = async (provider: string, shouldFail: boolean) => {
    try {
      await apiFetch(`/api/v1/providers/${provider}/toggle-failure`, {
        method: 'POST',
        body: JSON.stringify({ shouldFail }),
      });
      setSimulationLog(`[CIRCUIT BREAKER] Toggled ${provider} failure to ${shouldFail}.`);
      void refreshData();
    } catch (err: any) {
      setSimulationLog(`[ERROR] ${err.message}`);
    }
  };

  const inspectNotification = async (id: string) => {
    try {
      const res = await apiFetch(`/api/v1/notifications/${id}`);
      const data = await res.json();
      setSelectedNotif(data);
    } catch (err) {
      console.error(err);
    }
  };

  const markNotificationRead = async (id: string) => {
    try {
      await apiFetch(`/api/v1/notifications/${id}/read`, { method: 'POST' });
      await inspectNotification(id);
      void refreshData();
    } catch (err) {
      console.error(err);
    }
  };

  const openRateNum = parseFloat((analytics?.open_rate || '0').replace('%', '')) || 0;
  const optOutRateNum = optOutStats?.opt_out_rate_percent ?? 0;

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#22211E] flex flex-col font-sans antialiased selection:bg-[#DCE8DC] selection:text-[#1E2E20]">
      {/* Top Navigation Bar */}
      <header className="border-b border-[#E6E3DC] bg-[#FFFFFF]/95 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-[0_1px_4px_rgba(30,29,26,0.03)]">
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-[#EAF2EA] border border-[#C3D8C4] text-[#3D6342] shadow-xs">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-bold text-base tracking-tight text-[#22211E]">Event-Driven Notification Engine</h1>
              <span className="px-2.5 py-0.5 text-[11px] font-mono font-semibold bg-[#ECE8F4] text-[#3D3252] border border-[#D2C9E6] rounded-full">
                BE-6B Enterprise
              </span>
              {authRole && (
                <span className="px-2.5 py-0.5 text-[11px] font-mono font-semibold bg-[#EAF2EA] text-[#264629] border border-[#C3D8C4] rounded-full">
                  JWT: {authRole}
                </span>
              )}
            </div>
            <p className="text-xs text-[#5F5C55] font-medium mt-0.5">
              Multi-Channel Delivery • TRAI DND Compliance • Atomic Frequency Capping
            </p>
          </div>
        </div>

        {/* Global Live KPIs & Session */}
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <div className="hidden lg:flex items-center gap-2.5 bg-[#FAF9F6] px-3.5 py-2 rounded-xl border border-[#E6E3DC]">
            <Activity className="w-4 h-4 text-[#4D7552]" />
            <div>
              <span className="text-[#5F5C55] block text-[10px] uppercase tracking-wider font-semibold">Delivery Rate</span>
              <span className="font-semibold font-mono text-[#22211E] text-xs">
                {analytics?.overall_delivery_rate || '0%'}
              </span>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-2.5 bg-[#FAF9F6] px-3.5 py-2 rounded-xl border border-[#E6E3DC]">
            <Zap className="w-4 h-4 text-[#68578A]" />
            <div>
              <span className="text-[#5F5C55] block text-[10px] uppercase tracking-wider font-semibold">Critical P99 Latency</span>
              <span className="font-semibold font-mono text-[#22211E] text-xs">
                {analytics?.p99_critical_latency_ms ?? 0} ms
              </span>
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-2.5 bg-[#FAF9F6] px-3.5 py-2 rounded-xl border border-[#E6E3DC]">
            <ShieldCheck className="w-4 h-4 text-[#4D7552]" />
            <div>
              <span className="text-[#5F5C55] block text-[10px] uppercase tracking-wider font-semibold">DND Violations</span>
              <span className="font-semibold font-mono text-[#264629] text-xs">
                {analytics?.dnd_violations ?? 0} Detected
              </span>
            </div>
          </div>
          <a
            href="/api-docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#ECE8F4] hover:bg-[#E1DBEE] text-[#3D3252] border border-[#D2C9E6] font-semibold rounded-xl text-xs transition-all shadow-xs"
          >
            <FileText className="w-3.5 h-3.5 text-[#584878]" />
            Swagger Docs
            <ExternalLink className="w-3 h-3 text-[#68578A]" />
          </a>
          {accessToken && (
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#F3F1EC] hover:bg-[#EAE7DF] text-[#22211E] border border-[#DDD9CF] font-semibold rounded-xl text-xs cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign Out
            </button>
          )}
        </div>
      </header>

      {/* Sign-in Prompt when unauthenticated */}
      {!accessToken && (
        <div className="bg-[#FFF9EC] border-b border-[#E6D9B5] px-6 py-4">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs">
            <div>
              <span className="font-bold text-[#4D3B14]">JWT Authentication Required for /api/v1/*</span>
              <span className="text-[#6E5927] ml-2">
                Sign in with your operator or admin credentials to manage events, simulations, and DLQ records.
              </span>
              {authError && <span className="ml-2 text-[#7A353B] font-semibold">{authError}</span>}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void performLogin(loginEmail, loginPassword);
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Email"
                className="bg-[#FFFFFF] border border-[#D8D4CA] rounded-xl px-3 py-1.5 text-xs text-[#22211E]"
                required
              />
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Password"
                className="bg-[#FFFFFF] border border-[#D8D4CA] rounded-xl px-3 py-1.5 text-xs text-[#22211E]"
                required
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#DCE8DC] hover:bg-[#CFE0CF] text-[#1E2E20] border border-[#B9CEBA] font-semibold rounded-xl cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" /> Sign In
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Navigation Sub-Bar */}
      <nav className="bg-[#FFFFFF] border-b border-[#E6E3DC] px-6 flex items-center space-x-1 overflow-x-auto text-xs">
        {[
          { id: 'cockpit', label: 'Operations Cockpit', icon: Activity },
          { id: 'events', label: '25+ Events Ingestion', icon: Send },
          { id: 'simulations', label: '5 Benchmark Challenges', icon: Zap },
          { id: 'compliance', label: 'DND & Frequency Cap', icon: ShieldCheck },
          { id: 'providers', label: 'Circuit Breakers & Failover', icon: Server },
          { id: 'dlq', label: `Dead Letter Queue (${dlqEntries.length})`, icon: AlertTriangle },
          { id: 'docs', label: '5 Spec Errors & Architecture', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3.5 border-b-2 font-medium whitespace-nowrap transition cursor-pointer ${
                isActive
                  ? 'border-[#739B76] text-[#1E2E20] bg-[#F2F6F2] font-semibold'
                  : 'border-transparent text-[#5F5C55] hover:text-[#22211E] hover:bg-[#F6F5F1]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#3D6342]' : 'text-[#7A756D]'}`} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 md:p-8 space-y-6 max-w-7xl mx-auto w-full">
        {/* ========================================================= */}
        {/* TAB 1: OPERATIONS COCKPIT */}
        {/* ========================================================= */}
        {activeTab === 'cockpit' && (
          <div className="space-y-6">
            {/* Infrastructure Mode Banner */}
            {health && (
              <div className="bg-[#FFFFFF] border border-[#E6E3DC] px-5 py-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs shadow-[0_1px_6px_rgba(30,29,26,0.03)]">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-semibold text-[#22211E]">Infrastructure State:</span>
                  {Object.entries(health.components || {}).map(([key, val]) => (
                    <span
                      key={key}
                      className={`px-2.5 py-0.5 rounded-full font-mono text-[11px] font-medium border ${
                        val === 'UP' || val === 'CONNECTED'
                          ? 'bg-[#EAF2EA] text-[#264629] border-[#C3D8C4]'
                          : 'bg-[#F6EFE0] text-[#5E461F] border-[#E3D4B4]'
                      }`}
                    >
                      {key}: {val}
                    </span>
                  ))}
                  <span className="px-2.5 py-0.5 rounded-full font-mono text-[11px] bg-[#ECE8F4] text-[#3D3252] border border-[#D2C9E6]">
                    Providers: {health.provider_mode}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {alerts.length > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full font-mono text-[11px] font-semibold bg-[#F6E6E7] text-[#5E2F34] border border-[#E5C6C9]">
                      {alerts.length} Active Alert(s)
                    </span>
                  )}
                  <button
                    disabled={isSimulating || !accessToken}
                    onClick={handleRunQuickSampleBatch}
                    className="px-3 py-1.5 bg-[#DCE8DC] hover:bg-[#CFE0CF] disabled:opacity-50 text-[#1E2E20] border border-[#B9CEBA] font-semibold rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    Inject Sample Events
                  </button>
                </div>
              </div>
            )}

            {/* Top Metrics Cards - Backed strictly by live backend telemetry */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)] hover:border-[#D3CFC5] transition-colors">
                <div className="flex items-center justify-between text-[#5F5C55] text-xs mb-2 font-medium">
                  <span>Processed Events</span>
                  <div className="p-1.5 rounded-lg bg-[#EAF2EA]">
                    <Inbox className="w-4 h-4 text-[#3D6342]" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-[#22211E]">
                  {analytics?.total_events_processed ?? 0}
                </div>
                <div className="text-xs text-[#2E5433] mt-2 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#4D7552]" />{' '}
                  {analytics?.total_delivered ?? 0} Delivered / {analytics?.total_failed ?? 0} Failed
                </div>
              </div>

              <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)] hover:border-[#D3CFC5] transition-colors">
                <div className="flex items-center justify-between text-[#5F5C55] text-xs mb-2 font-medium">
                  <span>Critical Delivery Rate</span>
                  <div className="p-1.5 rounded-lg bg-[#F6E6E7]">
                    <AlertTriangle className="w-4 h-4 text-[#964F56]" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-[#22211E]">
                  {analytics?.critical_delivery_rate || '0%'}
                </div>
                <div className="text-xs text-[#5F5C55] mt-2 font-medium">
                  P99 Critical Latency: {analytics?.p99_critical_latency_ms ?? 0} ms (SLA &lt; 10,000 ms)
                </div>
              </div>

              <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)] hover:border-[#D3CFC5] transition-colors">
                <div className="flex items-center justify-between text-[#5F5C55] text-xs mb-2 font-medium">
                  <span>Open &amp; Engagement Rate</span>
                  <div className="p-1.5 rounded-lg bg-[#ECE8F4]">
                    <BarChart3 className="w-4 h-4 text-[#584878]" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-[#22211E]">
                  {analytics?.open_rate || '0%'}
                </div>
                <div className="text-xs text-[#5F5C55] mt-2 font-medium">
                  {openRateNum >= 45
                    ? 'Exceeds >45% Target'
                    : `${analytics?.total_read ?? 0} read receipts recorded (Target >45%)`}
                </div>
              </div>

              <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)] hover:border-[#D3CFC5] transition-colors">
                <div className="flex items-center justify-between text-[#5F5C55] text-xs mb-2 font-medium">
                  <span>Opt-Out &amp; DND Compliance</span>
                  <div className="p-1.5 rounded-lg bg-[#EAF2EA]">
                    <ShieldCheck className="w-4 h-4 text-[#3D6342]" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-[#22211E]">
                  {optOutRateNum}%
                </div>
                <div className="text-xs text-[#2E5433] mt-2 font-medium">
                  {optOutStats?.dnd_blocked_total ?? 0} DND Blocked • Total Cost ₹
                  {optOutStats?.total_cost_inr?.toFixed(2) ?? '0.00'}
                </div>
              </div>
            </div>

            {/* Live Pipeline Flow Visualizer */}
            <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-5 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#5F5C55] mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#4D7552]" /> Event-Driven Stream Pipeline
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-left text-xs">
                <div className="p-3.5 bg-[#FAF9F6] rounded-xl border border-[#E6E3DC]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[#22211E]">1. Ingestion API</span>
                    <span className="w-2 h-2 rounded-full bg-[#68916D]" />
                  </div>
                  <div className="text-xs text-[#5F5C55] font-mono">JWT + Zod + Idempotency</div>
                </div>
                <div className="p-3.5 bg-[#FAF9F6] rounded-xl border border-[#E6E3DC]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[#22211E]">2. Kafka Topic Stream</span>
                    <span className="w-2 h-2 rounded-full bg-[#8A79AD]" />
                  </div>
                  <div className="text-xs text-[#5F5C55] font-mono">
                    {health?.component_modes?.kafka || 'STREAM'}
                  </div>
                </div>
                <div className="p-3.5 bg-[#FAF9F6] rounded-xl border border-[#E6E3DC]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[#22211E]">3. TRAI DND &amp; Caps</span>
                    <span className="w-2 h-2 rounded-full bg-[#68916D]" />
                  </div>
                  <div className="text-xs text-[#2E5433] font-mono font-medium">
                    {optOutStats?.frequency_cap_hits ?? 0} Cap Hits
                  </div>
                </div>
                <div className="p-3.5 bg-[#FAF9F6] rounded-xl border border-[#E6E3DC]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[#22211E]">4. RabbitMQ Priority</span>
                    <span className="w-2 h-2 rounded-full bg-[#8A79AD]" />
                  </div>
                  <div className="text-xs text-[#5F5C55] font-mono">
                    {health?.component_modes?.rabbitmq || 'QUEUED'}
                  </div>
                </div>
                <div className="p-3.5 bg-[#FAF9F6] rounded-xl border border-[#E6E3DC]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[#22211E]">5. Multi-Channel</span>
                    <span className="w-2 h-2 rounded-full bg-[#C07C82]" />
                  </div>
                  <div className="text-xs text-[#5F5C55] font-mono">SMS, Email, Push, WA, InApp</div>
                </div>
              </div>
            </div>

            {/* Split View: Live Notification Feed + Selected Details */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Notification Table */}
              <div className="lg:col-span-2 bg-[#FFFFFF] border border-[#E6E3DC] rounded-2xl p-5 flex flex-col h-[500px] shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-sm text-[#22211E] flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-[#4D7552]" /> Real-time Notification Stream
                  </h3>
                  <button
                    onClick={() => void refreshData()}
                    className="px-3 py-1.5 bg-[#F3F1EC] hover:bg-[#EAE7DF] border border-[#DDD9CF] rounded-xl text-[#22211E] text-xs flex items-center gap-1.5 transition-colors cursor-pointer font-medium"
                  >
                    <RefreshCw className="w-3 h-3 text-[#4D7552]" /> Refresh
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                  {notifications.map((n) => {
                    const isSelected = selectedNotif?.notification?.id === n.id;
                    return (
                      <div
                        key={n.id}
                        onClick={() => void inspectNotification(n.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between gap-3 text-xs ${
                          isSelected
                            ? 'bg-[#F2F6F2] border-[#9EBA9F] shadow-xs'
                            : 'bg-[#FAF9F6] hover:bg-[#F4F2EC] border-[#E6E3DC] hover:border-[#D3CFC5]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`px-2 py-0.5 rounded-md font-mono font-semibold text-[10px] shrink-0 ${
                              n.priority === 'CRITICAL'
                                ? 'bg-[#F6E6E7] text-[#5E2F34] border border-[#E5C6C9]'
                                : n.priority === 'HIGH'
                                ? 'bg-[#F6EFE0] text-[#5E461F] border border-[#E3D4B4]'
                                : 'bg-[#ECE8F4] text-[#3D3252] border border-[#D2C9E6]'
                            }`}
                          >
                            {n.eventType}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-[#22211E] truncate">
                              {n.subject || n.renderedBody.slice(0, 60)}
                            </div>
                            <div className="text-xs text-[#5F5C55] mt-0.5 truncate">
                              To: <span className="font-mono text-[#22211E] font-medium">{n.recipientAddress}</span> •
                              Provider: <span className="text-[#3C3A35] font-medium">{n.provider}</span> • Lang:{' '}
                              <span className="text-[#3C3A35] font-medium">{n.language}</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold inline-block ${
                              n.status === 'DELIVERED' || n.status === 'READ'
                                ? 'bg-[#EAF2EA] text-[#264629] border border-[#C3D8C4]'
                                : n.status === 'DND'
                                ? 'bg-[#ECE8F4] text-[#3D3252] border border-[#D2C9E6]'
                                : n.status === 'CAPPED'
                                ? 'bg-[#F6EFE0] text-[#5E461F] border border-[#E3D4B4]'
                                : n.status === 'QUIET'
                                ? 'bg-[#F3F1EC] text-[#4E4B44] border border-[#DDD9CF]'
                                : 'bg-[#F6E6E7] text-[#5E2F34] border border-[#E5C6C9]'
                            }`}
                          >
                            {n.status}
                          </span>
                          <div className="text-xs font-mono text-[#5F5C55] mt-1 font-medium">₹{n.costInr?.toFixed(2)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {notifications.length === 0 && (
                    <div className="text-center py-16 text-[#5F5C55] text-xs">
                      No notifications yet. Use &ldquo;Inject Sample Events&rdquo; or open 25+ Events Ingestion.
                    </div>
                  )}
                </div>
              </div>

              {/* Inspector Pane */}
              <div className="bg-[#FFFFFF] border border-[#E6E3DC] rounded-2xl p-5 flex flex-col h-[500px] shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-sm text-[#22211E] flex items-center gap-2">
                    <Search className="w-4 h-4 text-[#68578A]" /> Complete State &amp; Compliance Audit
                  </h3>
                  {selectedNotif?.notification?.id && selectedNotif.notification.status !== 'READ' && (
                    <button
                      onClick={() => void markNotificationRead(selectedNotif.notification.id)}
                      className="px-2.5 py-1 bg-[#ECE8F4] hover:bg-[#E1DBEE] text-[#3D3252] border border-[#D2C9E6] rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3 h-3" /> Record Read
                    </button>
                  )}
                </div>
                {selectedNotif?.notification ? (
                  <div className="flex-1 overflow-y-auto space-y-3 text-xs pr-1">
                    <div className="bg-[#FAF9F6] p-3.5 rounded-xl border border-[#E6E3DC]">
                      <div className="text-[#2E5433] text-[11px] uppercase font-semibold tracking-wider">Message Content</div>
                      <div className="font-medium text-[#22211E] mt-1.5 leading-relaxed">
                        {selectedNotif.notification.renderedBody}
                      </div>
                    </div>

                    <div className="bg-[#FAF9F6] p-3.5 rounded-xl border border-[#E6E3DC]">
                      <div className="text-[#4B3D68] text-[11px] uppercase font-semibold tracking-wider mb-2">
                        Compliance Verification Log
                      </div>
                      <div className="space-y-2 text-[#22211E]">
                        <div className="flex justify-between gap-2">
                          <span className="text-[#5F5C55]">DND Check Result:</span>
                          <span className="font-semibold text-[#264629] font-mono">
                            {selectedNotif.compliance_audit?.dndResult || 'N/A (Non-SMS)'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[#5F5C55]">Frequency Cap:</span>
                          <span className="font-semibold text-[#264629] font-mono">
                            {selectedNotif.compliance_audit?.frequencyCapResult || 'PASS'}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-[#5F5C55]">Quiet Hours Action:</span>
                          <span className="font-semibold text-[#22211E] font-mono">
                            {selectedNotif.compliance_audit?.quietHoursAction || 'DISPATCH_IMMEDIATE'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#FAF9F6] p-3.5 rounded-xl border border-[#E6E3DC]">
                      <div className="text-[#4B3D68] text-[11px] uppercase font-semibold tracking-wider mb-2">
                        Immutable State History
                      </div>
                      <div className="space-y-2">
                        {selectedNotif.state_history?.map((st: any, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs text-[#22211E] border-b border-[#E6E3DC] last:border-b-0 pb-1.5 last:pb-0"
                          >
                            <span className="font-mono text-[#264629] font-medium">
                              {st.previousState} ➔ {st.newState}
                            </span>
                            <span className="text-xs text-[#5F5C55] font-mono">{st.actorService}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-24 text-[#5F5C55] text-xs leading-relaxed px-4">
                    Click any notification from the stream to inspect its audit log, DND timestamp, and state transitions.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: 25+ FINANCIAL EVENT TAXONOMY & INGESTION */}
        {/* ========================================================= */}
        {activeTab === 'events' && (
          <div className="space-y-6">
            <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
              <h2 className="font-bold text-base text-[#22211E] mb-1.5">Ingest Financial Event (25 Event Types)</h2>
              <p className="text-xs text-[#5F5C55] mb-6 leading-relaxed">
                Test strict Zod validation and multi-channel dispatch across Transactions (TXNX), Risk &amp; Margin (RISK), SIPs (SIPX), Market (MKTX), and Regulatory Directives (REGX).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-[#22211E] mb-2">Select Event Type</label>
                  <select
                    value={selectedEventType}
                    onChange={(e) => setSelectedEventType(e.target.value)}
                    className="w-full bg-[#FFFFFF] border border-[#D8D4CA] focus:border-[#739B76] focus:outline-none focus:ring-2 focus:ring-[#DCE8DC] rounded-xl p-2.5 text-xs text-[#22211E] font-medium transition"
                  >
                    <optgroup label="Risk & Margin (CRITICAL Mandatory)">
                      <option value="RISK-001">RISK-001: Margin Call Warning (Critical)</option>
                      <option value="RISK-002">RISK-002: Margin Shortfall (Critical)</option>
                      <option value="RISK-003">RISK-003: Position Squared Off</option>
                      <option value="RISK-004">RISK-004: Portfolio Risk Alert</option>
                      <option value="RISK-005">RISK-005: Concentration Alert</option>
                    </optgroup>
                    <optgroup label="Transaction Events (TXNX)">
                      <option value="TXNX-001">TXNX-001: Buy Order Executed</option>
                      <option value="TXNX-002">TXNX-002: Sell Order Executed</option>
                      <option value="TXNX-003">TXNX-003: Order Rejected</option>
                      <option value="TXNX-004">TXNX-004: Dividend Credited</option>
                      <option value="TXNX-005">TXNX-005: Funds Deposited</option>
                    </optgroup>
                    <optgroup label="SIP & Investment (SIPX)">
                      <option value="SIPX-001">SIPX-001: SIP Due Reminder</option>
                      <option value="SIPX-002">SIPX-002: SIP Executed</option>
                      <option value="SIPX-003">SIPX-003: SIP Failed</option>
                      <option value="SIPX-004">SIPX-004: SIP Step-Up Reminder</option>
                      <option value="SIPX-005">SIPX-005: Goal Milestone Reached</option>
                    </optgroup>
                    <optgroup label="Market & Price (MKTX)">
                      <option value="MKTX-001">MKTX-001: Price Alert Triggered</option>
                      <option value="MKTX-002">MKTX-002: Circuit Breaker Hit</option>
                      <option value="MKTX-003">MKTX-003: Market Open/Close</option>
                      <option value="MKTX-004">MKTX-004: 52-Week High/Low</option>
                      <option value="MKTX-005">MKTX-005: Earnings Announcement</option>
                    </optgroup>
                    <optgroup label="Regulatory Directives (REGX)">
                      <option value="REGX-001">REGX-001: KYC Expiry Warning</option>
                      <option value="REGX-002">REGX-002: Nominee Update Reminder</option>
                      <option value="REGX-003">REGX-003: Contract Note Generated</option>
                      <option value="REGX-004">REGX-004: Tax Statement Available</option>
                      <option value="REGX-005">REGX-005: Regulatory Policy Change (Emergency)</option>
                    </optgroup>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#22211E] mb-2">Target User ID</label>
                  <input
                    type="text"
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    className="w-full bg-[#FFFFFF] border border-[#D8D4CA] focus:border-[#739B76] focus:outline-none focus:ring-2 focus:ring-[#DCE8DC] rounded-xl p-2.5 text-xs text-[#22211E] font-mono font-medium transition"
                  />
                  <span className="text-xs text-[#5F5C55] mt-1.5 block">Tip: User containing &lsquo;999&rsquo; is DND registered</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#22211E] mb-2">Language (Handlebars Engine)</label>
                  <select
                    value={selectedLang}
                    onChange={(e) => setSelectedLang(e.target.value)}
                    className="w-full bg-[#FFFFFF] border border-[#D8D4CA] focus:border-[#739B76] focus:outline-none focus:ring-2 focus:ring-[#DCE8DC] rounded-xl p-2.5 text-xs text-[#22211E] font-medium transition"
                  >
                    <option value="en">English (en)</option>
                    <option value="hi">Hindi (hi)</option>
                    <option value="mr">Marathi (mr)</option>
                    <option value="ta">Tamil (ta)</option>
                    <option value="te">Telugu (te)</option>
                  </select>
                </div>

                <div className="flex items-end md:pb-6">
                  <button
                    onClick={() => void handleTriggerEvent()}
                    disabled={!accessToken}
                    className="w-full py-2.5 px-5 bg-[#DCE8DC] hover:bg-[#CFE0CF] disabled:opacity-50 text-[#1E2E20] border border-[#B9CEBA] font-semibold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-all"
                  >
                    <Send className="w-3.5 h-3.5 text-[#264629]" /> Ingest Event ({eventSourceSystem})
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#22211E] mb-2">
                  Strict Schema Payload JSON ({selectedEventType})
                </label>
                <textarea
                  rows={6}
                  value={eventPayloadJson}
                  onChange={(e) => setEventPayloadJson(e.target.value)}
                  className="w-full bg-[#FAF9F6] border border-[#D8D4CA] rounded-xl p-3 font-mono text-xs text-[#22211E] focus:border-[#739B76] focus:outline-none"
                />
              </div>

              {simulationLog && (
                <div className="mt-4 p-4 bg-[#F5F4F0] border border-[#E2DFD7] rounded-xl font-mono text-xs text-[#2B3A2E] whitespace-pre-wrap max-h-56 overflow-y-auto">
                  {simulationLog}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: BENCHMARK SIMULATION CHALLENGES */}
        {/* ========================================================= */}
        {activeTab === 'simulations' && (
          <div className="space-y-6">
            <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
              <h2 className="font-bold text-base text-[#22211E] mb-1.5">5 Mandatory Technical Benchmark Challenges</h2>
              <p className="text-xs text-[#5F5C55] mb-6 leading-relaxed">
                Execute representative benchmark slices for Section 19 challenges: high-load market crashes, circuit-breaking failover, compliance audit exports, notification storms, and multilingual emergency broadcasting.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-[#FAF9F6] border border-[#E6E3DC] hover:border-[#D3CFC5] p-5 rounded-2xl flex flex-col justify-between transition-colors">
                  <div>
                    <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#F6E6E7] text-[#5E2F34] border border-[#E5C6C9]">
                      CHALLENGE 1
                    </span>
                    <h3 className="font-bold text-sm text-[#22211E] mt-3">Market Crash Simulation</h3>
                    <p className="text-xs text-[#5F5C55] mt-1.5 leading-relaxed">
                      Batch of critical margin calls (RISK-001) and price alerts (MKTX-001) validating &lt;10s P99 latency and zero DND violations.
                    </p>
                  </div>
                  <button
                    disabled={isSimulating || !accessToken}
                    onClick={() => void runSimulation('market-crash', 'Challenge 1: Market Crash')}
                    className="mt-5 w-full py-2.5 px-4 bg-[#EAF2EA] hover:bg-[#DCE8DC] disabled:opacity-50 text-[#1E2E20] border border-[#C3D8C4] font-semibold rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    Run Market Crash Test
                  </button>
                </div>

                <div className="bg-[#FAF9F6] border border-[#E6E3DC] hover:border-[#D3CFC5] p-5 rounded-2xl flex flex-col justify-between transition-colors">
                  <div>
                    <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#F6EFE0] text-[#5E461F] border border-[#E3D4B4]">
                      CHALLENGE 2
                    </span>
                    <h3 className="font-bold text-sm text-[#22211E] mt-3">Provider Outage &amp; Failover</h3>
                    <p className="text-xs text-[#5F5C55] mt-1.5 leading-relaxed">
                      Simulates MSG91 outage during trading hours. Trips circuit breaker after 5 failures and fails over critical SMS to Twilio.
                    </p>
                  </div>
                  <button
                    disabled={isSimulating || !accessToken}
                    onClick={() => void runSimulation('provider-outage', 'Challenge 2: Provider Outage')}
                    className="mt-5 w-full py-2.5 px-4 bg-[#EAF2EA] hover:bg-[#DCE8DC] disabled:opacity-50 text-[#1E2E20] border border-[#C3D8C4] font-semibold rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    Trigger Outage &amp; Failover
                  </button>
                </div>

                <div className="bg-[#FAF9F6] border border-[#E6E3DC] hover:border-[#D3CFC5] p-5 rounded-2xl flex flex-col justify-between transition-colors">
                  <div>
                    <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#ECE8F4] text-[#3D3252] border border-[#D2C9E6]">
                      CHALLENGE 3
                    </span>
                    <h3 className="font-bold text-sm text-[#22211E] mt-3">90-Day Compliance Audit</h3>
                    <p className="text-xs text-[#5F5C55] mt-1.5 leading-relaxed">
                      Exports masked SMS records, dispatch-time DND check timestamps, consent records, and delivery receipts.
                    </p>
                  </div>
                  <button
                    disabled={isSimulating || !accessToken}
                    onClick={() => void runSimulation('compliance-audit', 'Challenge 3: Compliance Audit')}
                    className="mt-5 w-full py-2.5 px-4 bg-[#ECE8F4] hover:bg-[#E1DBEE] disabled:opacity-50 text-[#3D3252] border border-[#D2C9E6] font-semibold rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    Generate Audit Report
                  </button>
                </div>

                <div className="bg-[#FAF9F6] border border-[#E6E3DC] hover:border-[#D3CFC5] p-5 rounded-2xl flex flex-col justify-between transition-colors">
                  <div>
                    <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#ECE8F4] text-[#3D3252] border border-[#D2C9E6]">
                      CHALLENGE 4
                    </span>
                    <h3 className="font-bold text-sm text-[#22211E] mt-3">Notification Storm (500 Dups)</h3>
                    <p className="text-xs text-[#5F5C55] mt-1.5 leading-relaxed">
                      Injects 500 duplicate price-alert events within 60s. Verifies deduplication suppression and storm incident logging.
                    </p>
                  </div>
                  <button
                    disabled={isSimulating || !accessToken}
                    onClick={() => void runSimulation('notification-storm', 'Challenge 4: Notification Storm')}
                    className="mt-5 w-full py-2.5 px-4 bg-[#ECE8F4] hover:bg-[#E1DBEE] disabled:opacity-50 text-[#3D3252] border border-[#D2C9E6] font-semibold rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    Inject 500 Storm Events
                  </button>
                </div>

                <div className="bg-[#FAF9F6] border border-[#E6E3DC] hover:border-[#D3CFC5] p-5 rounded-2xl flex flex-col justify-between transition-colors">
                  <div>
                    <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#EAF2EA] text-[#264629] border border-[#C3D8C4]">
                      CHALLENGE 5
                    </span>
                    <h3 className="font-bold text-sm text-[#22211E] mt-3">Multilingual Emergency (REGX-005)</h3>
                    <p className="text-xs text-[#5F5C55] mt-1.5 leading-relaxed">
                      Emergency RBI policy broadcast across Hindi (42%), Marathi (18%), Tamil (12%), Telugu (8%), and English (20%).
                    </p>
                  </div>
                  <button
                    disabled={isSimulating || !accessToken}
                    onClick={() => void runSimulation('multilingual-emergency', 'Challenge 5: Multilingual Emergency')}
                    className="mt-5 w-full py-2.5 px-4 bg-[#DCE8DC] hover:bg-[#CFE0CF] disabled:opacity-50 text-[#1E2E20] border border-[#B9CEBA] font-semibold rounded-xl text-xs cursor-pointer transition-colors shadow-xs"
                  >
                    Broadcast Emergency
                  </button>
                </div>
              </div>

              {simulationLog && (
                <div className="mt-6 p-4 bg-[#F5F4F0] border border-[#E2DFD7] rounded-xl font-mono text-xs text-[#2B3A2E] whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {simulationLog}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: COMPLIANCE, DND & FREQUENCY CAPPING */}
        {/* ========================================================= */}
        {activeTab === 'compliance' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
                <h3 className="font-bold text-base text-[#22211E] flex items-center gap-2 mb-2.5">
                  <ShieldCheck className="w-5 h-5 text-[#4D7552]" /> TRAI DND &amp; NCPR Compliance Guard
                </h3>
                <p className="text-xs text-[#5F5C55] mb-5 leading-relaxed">
                  Enforces Telecom Commercial Communications Customer Preference Regulations (TCCCPR). Mandatory DND scrub executed immediately at SMS dispatch time.
                </p>

                <div className="space-y-2 text-xs bg-[#FAF9F6] p-4 rounded-xl border border-[#E6E3DC]">
                  <div className="flex justify-between gap-4 py-2 border-b border-[#E6E3DC]">
                    <span className="text-[#5F5C55] font-medium">Statutory Transactional Exemption:</span>
                    <span className="font-semibold text-[#264629] text-right">ENABLED (Margin calls &amp; orders pass)</span>
                  </div>
                  <div className="flex justify-between gap-4 py-2 border-b border-[#E6E3DC]">
                    <span className="text-[#5F5C55] font-medium">Promotional Block on DND:</span>
                    <span className="font-semibold text-[#7A353B] text-right">
                      STRICTLY BLOCKED ({optOutStats?.dnd_blocked_total ?? 0} blocked)
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 py-2">
                    <span className="text-[#5F5C55] font-medium">DND Violations Recorded:</span>
                    <span className="font-semibold text-[#3D3252] font-mono text-right">
                      {optOutStats?.dnd_violations_total ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
                <h3 className="font-bold text-base text-[#22211E] flex items-center gap-2 mb-2.5">
                  <Sliders className="w-5 h-5 text-[#68578A]" /> Multi-Dimensional Atomic Frequency Caps
                </h3>
                <p className="text-xs text-[#5F5C55] mb-5 leading-relaxed">
                  Rolling limits implemented via atomic Redis Lua sliding windows (with synchronized fallback) to eliminate race conditions.
                </p>

                <div className="space-y-2 text-xs bg-[#FAF9F6] p-4 rounded-xl border border-[#E6E3DC]">
                  <div className="flex justify-between gap-4 py-2 border-b border-[#E6E3DC]">
                    <span className="text-[#5F5C55] font-medium">Global User Daily Cap:</span>
                    <span className="font-mono font-semibold text-[#22211E]">12 notifications / 24h</span>
                  </div>
                  <div className="flex justify-between gap-4 py-2 border-b border-[#E6E3DC]">
                    <span className="text-[#5F5C55] font-medium">SMS / Push / Email Daily Caps:</span>
                    <span className="font-mono font-semibold text-[#22211E]">5 SMS / 8 Push / 3 Email</span>
                  </div>
                  <div className="flex justify-between gap-4 py-2 border-b border-[#E6E3DC]">
                    <span className="text-[#5F5C55] font-medium">Category Hourly Cap &amp; Cooldown:</span>
                    <span className="font-mono font-semibold text-[#22211E]">3/60m &amp; 15m Cooldown</span>
                  </div>
                  <div className="flex justify-between gap-4 py-2">
                    <span className="text-[#5F5C55] font-medium">Quiet Hours Queued / Cap Hits:</span>
                    <span className="font-semibold text-[#264629] text-right font-mono">
                      {optOutStats?.quiet_hours_queued ?? 0} Queued / {optOutStats?.frequency_cap_hits ?? 0} Capped
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 5: PROVIDER CIRCUIT BREAKERS & FAILOVER */}
        {/* ========================================================= */}
        {activeTab === 'providers' && (
          <div className="space-y-6">
            <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
              <h2 className="font-bold text-base text-[#22211E] mb-1.5">Delivery Providers &amp; Circuit Breakers</h2>
              <p className="text-xs text-[#5F5C55] mb-6 leading-relaxed">
                Each delivery provider is guarded by an autonomous 3-state Circuit Breaker (CLOSED ➔ OPEN ➔ HALF_OPEN). Toggle simulated failure to verify automated failover.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {circuitBreakers.map((cb, idx) => {
                  const isOpen = cb.state === 'OPEN';
                  const provInfo = providersHealth.find((p) => p.name === cb.name);
                  return (
                    <div key={idx} className="bg-[#FAF9F6] border border-[#E6E3DC] p-5 rounded-2xl">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#22211E] text-sm">{cb.name}</span>
                        <div className="flex items-center gap-1.5">
                          {provInfo?.mode && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#ECE8F4] text-[#3D3252] border border-[#D2C9E6]">
                              {provInfo.mode}
                            </span>
                          )}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                              cb.state === 'CLOSED'
                                ? 'bg-[#EAF2EA] text-[#264629] border border-[#C3D8C4]'
                                : isOpen
                                ? 'bg-[#F6E6E7] text-[#5E2F34] border border-[#E5C6C9]'
                                : 'bg-[#F6EFE0] text-[#5E461F] border border-[#E3D4B4]'
                            }`}
                          >
                            {cb.state}
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-[#5F5C55] mt-3 space-y-1.5">
                        <div>
                          Trip Threshold: <span className="text-[#22211E] font-mono font-medium">{cb.threshold} failures in 60s</span>
                        </div>
                        <div>
                          Recent Failures: <span className="text-[#22211E] font-mono font-medium">{cb.recentFailures}</span>
                        </div>
                      </div>

                      {cb.name === 'MSG91' && (
                        <div className="mt-4 pt-3.5 border-t border-[#E6E3DC]">
                          <button
                            onClick={() => void toggleProviderFailure('MSG91', !isOpen)}
                            className={`w-full py-2 px-3 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                              isOpen
                                ? 'bg-[#DCE8DC] hover:bg-[#CFE0CF] text-[#1E2E20] border border-[#B9CEBA]'
                                : 'bg-[#F6E6E7] hover:bg-[#EED8DA] text-[#5E2F34] border border-[#E5C6C9]'
                            }`}
                          >
                            {isOpen ? 'Recover MSG91 (Close Breaker)' : 'Simulate MSG91 Outage'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 6: DEAD LETTER QUEUE (DLQ) */}
        {/* ========================================================= */}
        {activeTab === 'dlq' && (
          <div className="space-y-6">
            <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="font-bold text-base text-[#22211E]">Dead Letter Queue (DLQ) Management</h2>
                  <p className="text-xs text-[#5F5C55] mt-1">
                    Failed deliveries exceeding maximum exponential backoff retries or permanent error classifications.
                  </p>
                </div>
                <span
                  className={`px-3 py-1 font-mono font-semibold text-xs rounded-full border ${
                    dlqEntries.length > 0
                      ? 'bg-[#F6E6E7] text-[#5E2F34] border-[#E5C6C9]'
                      : 'bg-[#EAF2EA] text-[#264629] border-[#C3D8C4]'
                  }`}
                >
                  DLQ Depth: {dlqEntries.length}
                </span>
              </div>

              <div className="space-y-2.5 mt-4">
                {dlqEntries.map((dlq: any) => (
                  <div
                    key={dlq.id}
                    className="p-4 bg-[#FAF9F6] border border-[#E6E3DC] rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[#7A353B]">{dlq.reason}</div>
                      <div className="text-xs text-[#5F5C55] mt-1">
                        Notification ID: <span className="font-mono text-[#22211E] font-medium">{dlq.notificationId}</span> •
                        Attempts: <span className="text-[#22211E] font-mono">{dlq.attemptsMade}</span> • Class:{' '}
                        <span className="text-[#22211E] font-mono">{dlq.errorClassification}</span> • Status:{' '}
                        <span className="text-[#22211E] font-mono">{dlq.status}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          await apiFetch(`/api/v1/dlq/${dlq.id}/retry`, { method: 'POST' });
                          void refreshData();
                        }}
                        className="px-3.5 py-1.5 bg-[#DCE8DC] hover:bg-[#CFE0CF] text-[#1E2E20] border border-[#B9CEBA] font-semibold rounded-xl text-xs cursor-pointer transition-colors"
                      >
                        Retry
                      </button>
                      <button
                        onClick={async () => {
                          await apiFetch(`/api/v1/dlq/${dlq.id}/discard`, { method: 'POST' });
                          void refreshData();
                        }}
                        className="px-3.5 py-1.5 bg-[#F3F1EC] hover:bg-[#EAE7DF] text-[#22211E] font-medium rounded-xl text-xs cursor-pointer transition-colors border border-[#DDD9CF]"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ))}
                {dlqEntries.length === 0 && (
                  <div className="text-center py-16 text-[#5F5C55] text-xs">
                    DLQ is currently clean. Zero permanent delivery failures.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 7: 5 SPECIFICATION ERRORS IDENTIFIED & ARCHITECTURE */}
        {/* ========================================================= */}
        {activeTab === 'docs' && (
          <div className="space-y-6">
            <div className="bg-[#FFFFFF] border border-[#E6E3DC] p-6 rounded-2xl shadow-[0_2px_10px_-3px_rgba(30,29,26,0.05)]">
              <div className="flex items-center gap-2.5 text-[#584878] mb-2">
                <Sparkles className="w-5 h-5 text-[#68578A]" />
                <h2 className="font-bold text-base text-[#22211E]">
                  5 Deliberate Technical Specification Errors &amp; Engineering Fixes
                </h2>
              </div>
              <p className="text-xs text-[#5F5C55] mb-6 leading-relaxed">
                As required in Section 25, the source specification contains 5 deliberate technical traps. Below is their architectural identification and remediation:
              </p>

              <div className="space-y-4">
                <div className="p-5 bg-[#FAF9F6] border border-[#E6E3DC] rounded-2xl">
                  <div className="font-bold text-[#7A353B] text-xs font-mono uppercase">
                    Error 1: Partitioning Primary Key Mismatch (Section 12)
                  </div>
                  <div className="text-xs text-[#5F5C55] mt-2 leading-relaxed">
                    <strong className="text-[#22211E]">The Flaw:</strong> Prompt specifies declarative monthly partitioning on notifications table by created_at with a standalone UUID id primary key. In PostgreSQL, partitioned tables strictly require that all unique constraints and primary keys contain all partitioning columns (id, created_at).
                  </div>
                  <div className="text-xs text-[#264629] mt-2 font-medium leading-relaxed">
                    <strong className="text-[#22211E]">The Fix:</strong> Configured composite primary key PRIMARY KEY (id, created_at) and default fallback partition in PostgreSQL migrations.
                  </div>
                </div>

                <div className="p-5 bg-[#FAF9F6] border border-[#E6E3DC] rounded-2xl">
                  <div className="font-bold text-[#7A353B] text-xs font-mono uppercase">
                    Error 2: TRAI DND Window &amp; Scope Discrepancy (Section 8 &amp; 10)
                  </div>
                  <div className="text-xs text-[#5F5C55] mt-2 leading-relaxed">
                    <strong className="text-[#22211E]">The Flaw:</strong> Prompt specifies 21:00–08:00 and conflates TRAI DND with OTT messaging. Under TRAI TCCCPR regulations, commercial blackout extends to 09:00 and governs carrier SMS/voice, whereas WhatsApp/Email rely on separate explicit opt-in consent.
                  </div>
                  <div className="text-xs text-[#264629] mt-2 font-medium leading-relaxed">
                    <strong className="text-[#22211E]">The Fix:</strong> Decoupled telecom TRAI DND checks from OTT WhatsApp/Email consent checks in DndService &amp; NotificationRouter.
                  </div>
                </div>

                <div className="p-5 bg-[#FAF9F6] border border-[#E6E3DC] rounded-2xl">
                  <div className="font-bold text-[#7A353B] text-xs font-mono uppercase">
                    Error 3: FCM ➔ APNS Fallback Fallacy (Section 5)
                  </div>
                  <div className="text-xs text-[#5F5C55] mt-2 leading-relaxed">
                    <strong className="text-[#22211E]">The Flaw:</strong> Failing an Android push token from FCM over to APNS guarantees 100% failure because APNS exclusively serves Apple/iOS device tokens.
                  </div>
                  <div className="text-xs text-[#264629] mt-2 font-medium leading-relaxed">
                    <strong className="text-[#22211E]">The Fix:</strong> Device-OS aware routing in ProviderManager: iOS tokens (`apns_token_*`) route via APNS ➔ FCM, while Android tokens never fail over to APNS.
                  </div>
                </div>

                <div className="p-5 bg-[#FAF9F6] border border-[#E6E3DC] rounded-2xl">
                  <div className="font-bold text-[#7A353B] text-xs font-mono uppercase">
                    Error 4: Same-Event Cooldown on Critical Margin Calls (Section 9)
                  </div>
                  <div className="text-xs text-[#5F5C55] mt-2 leading-relaxed">
                    <strong className="text-[#22211E]">The Flaw:</strong> Applying a 15-minute same-event cooldown indiscriminately suppresses consecutive margin calls during rapid market crashes.
                  </div>
                  <div className="text-xs text-[#264629] mt-2 font-medium leading-relaxed">
                    <strong className="text-[#22211E]">The Fix:</strong> CRITICAL and REGULATORY_MANDATORY events explicitly bypass cooldowns, hourly category limits, and daily caps.
                  </div>
                </div>

                <div className="p-5 bg-[#FAF9F6] border border-[#E6E3DC] rounded-2xl">
                  <div className="font-bold text-[#7A353B] text-xs font-mono uppercase">
                    Error 5: Critical Retry Backoff vs 10-Second Delivery SLA (Section 13)
                  </div>
                  <div className="text-xs text-[#5F5C55] mt-2 leading-relaxed">
                    <strong className="text-[#22211E]">The Flaw:</strong> Exponential retry backoff up to 60 seconds conflicts directly with the &lt;10s P99 CRITICAL event SLA.
                  </div>
                  <div className="text-xs text-[#264629] mt-2 font-medium leading-relaxed">
                    <strong className="text-[#22211E]">The Fix:</strong> Immediate circuit-breaker failover from MSG91 to Twilio on primary failure rather than delaying critical alerts behind backoff windows.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E6E3DC] bg-[#FFFFFF] px-6 py-4 text-xs text-[#5F5C55] flex flex-col md:flex-row items-center justify-between gap-2">
        <div>Event-Driven Financial Notification Engine • Project BE-6B</div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-[#264629] font-medium">Port 3000 Active</span>
          <span className="text-[#B5B0A6]">•</span>
          <span>Status: {health?.status || 'connecting'}</span>
          <span className="text-[#B5B0A6]">•</span>
          <span>PostgreSQL + Redis + Kafka + RabbitMQ</span>
        </div>
      </footer>
    </div>
  );
}
