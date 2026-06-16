import { useEffect, useMemo, useState } from 'react';
import {
  getVectorProviders,
  getVectorServices,
  registerVectorService,
  testVectorProvider,
  testVectorService,
  unregisterVectorService,
  type VectorHealthStatus,
  type VectorProvider,
  type VectorProviderTestConfig,
  type VectorProviderTestResult,
  type VectorService,
} from '../api/oracle';
import { ErrorMessage, Spinner } from './AsyncState';

type Client = {
  getVectorProviders: typeof getVectorProviders;
  testVectorProvider: typeof testVectorProvider;
  getVectorServices: typeof getVectorServices;
  registerVectorService: typeof registerVectorService;
  unregisterVectorService: typeof unregisterVectorService;
  testVectorService: typeof testVectorService;
};

type PanelProps = {
  client?: Client;
  initialProviders?: VectorProvider[];
  initialServices?: VectorService[];
};

const defaultClient: Client = { getVectorProviders, testVectorProvider, getVectorServices, registerVectorService, unregisterVectorService, testVectorService };

function providerDetail(provider: VectorProvider): string {
  const models = provider.models?.slice(0, 2).join(', ') || 'no models reported';
  return `${provider.status ?? (provider.available ? 'available' : 'unavailable')} · ${models}`;
}

function serviceDetail(service: VectorService): string {
  const endpoint = service.endpoint ?? 'builtin';
  const health = service.health?.status ?? 'unknown';
  return `${service.type} · ${endpoint} · ${health}`;
}

export function VectorProviderServicePanel({ client = defaultClient, initialProviders = [], initialServices = [] }: PanelProps) {
  const [providers, setProviders] = useState<VectorProvider[]>(initialProviders);
  const [services, setServices] = useState<VectorService[]>(initialServices);
  const [selectedProvider, setSelectedProvider] = useState(initialProviders[0]?.type ?? 'ollama');
  const [serviceName, setServiceName] = useState('turbovec');
  const [serviceEndpoint, setServiceEndpoint] = useState('http://localhost:8787');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const availableCount = useMemo(() => providers.filter((provider) => provider.available).length, [providers]);

  async function load() {
    setError('');
    try {
      const [nextProviders, nextServices] = await Promise.all([client.getVectorProviders(), client.getVectorServices()]);
      setProviders(nextProviders);
      setServices(nextServices);
      setSelectedProvider((current) => nextProviders.some((provider) => provider.type === current) ? current : nextProviders[0]?.type ?? current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => { void load(); }, [client]);

  async function withBusy<T>(label: string, action: () => Promise<T>, summarize: (result: T) => string) {
    setBusy(label);
    setMessage('');
    setError('');
    try {
      const result = await action();
      setMessage(summarize(result));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  const testProvider = () => withBusy(
    `provider:${selectedProvider}`,
    () => client.testVectorProvider({ provider: selectedProvider, text: 'oracle studio vector setup' } as VectorProviderTestConfig),
    (result: VectorProviderTestResult) => result.success ? `${result.provider} provider probe passed (${result.dimensions ?? 'unknown'} dims).` : `${result.provider} provider probe failed.`,
  );

  const registerService = () => withBusy(
    'register-service',
    () => client.registerVectorService({ name: serviceName.trim(), type: 'proxy', endpoint: serviceEndpoint.trim() }),
    () => `Registered ${serviceName.trim()} service.`,
  );

  const testService = (name: string) => withBusy(
    `service:${name}`,
    () => client.testVectorService(name),
    (result: VectorHealthStatus) => `${name} service health: ${result.status}.`,
  );

  const removeService = (name: string) => withBusy(
    `remove:${name}`,
    () => client.unregisterVectorService(name),
    () => `Removed ${name} service.`,
  );

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-provider-services-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Provider + service registry</p>
          <h2 id="vector-provider-services-title" className="mt-2 text-2xl font-semibold text-white">Embedding providers and storage services</h2>
          <p className="mt-2 text-sm text-slate-400">Auto-detect embedding providers, test the selected provider, and register proxy vector services.</p>
          <p className="mt-2 text-xs text-slate-500">{availableCount}/{providers.length} providers available · {services.length} services registered</p>
        </div>
        <button className="focus-ring rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200" type="button" onClick={() => void load()}>Refresh providers</button>
      </div>

      {error ? <div className="mt-4"><ErrorMessage title="Vector provider registry failed." message={error} /></div> : null}
      {message ? <p className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-sm text-teal-100">{message}</p> : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <ProviderSelector providers={providers} selectedProvider={selectedProvider} busy={busy} onSelect={setSelectedProvider} onTest={testProvider} />
        <ServiceRegistry
          busy={busy}
          serviceEndpoint={serviceEndpoint}
          serviceName={serviceName}
          services={services}
          onEndpoint={setServiceEndpoint}
          onName={setServiceName}
          onRegister={registerService}
          onRemove={removeService}
          onTest={testService}
        />
      </div>
    </section>
  );
}

function ProviderSelector({ providers, selectedProvider, busy, onSelect, onTest }: {
  providers: VectorProvider[];
  selectedProvider: string;
  busy: string;
  onSelect: (provider: string) => void;
  onTest: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="font-semibold text-teal-100">Embedding provider selector</h3>
      <div className="mt-3 grid gap-2">
        {providers.map((provider) => (
          <label key={provider.type} className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-200">
            <input type="radio" checked={selectedProvider === provider.type} onChange={() => onSelect(provider.type)} />
            <span><span className="font-semibold text-white">{provider.type}</span><br /><span className="text-slate-400">{providerDetail(provider)}</span></span>
          </label>
        ))}
        {!providers.length ? <p className="text-sm text-slate-500">Provider detection has not returned results yet.</p> : null}
      </div>
      <button className="focus-ring mt-3 rounded-xl bg-teal-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" disabled={!selectedProvider || Boolean(busy)} type="button" onClick={onTest}>{busy.startsWith('provider:') ? <Spinner label="Testing" /> : 'Test selected provider'}</button>
    </div>
  );
}

function ServiceRegistry({ busy, serviceEndpoint, serviceName, services, onEndpoint, onName, onRegister, onRemove, onTest }: {
  busy: string;
  serviceEndpoint: string;
  serviceName: string;
  services: VectorService[];
  onEndpoint: (endpoint: string) => void;
  onName: (name: string) => void;
  onRegister: () => void;
  onRemove: (name: string) => void;
  onTest: (name: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="font-semibold text-purple-100">Register vector service</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Name<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" value={serviceName} onChange={(event) => onName(event.target.value)} /></label>
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Endpoint<input className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" value={serviceEndpoint} onChange={(event) => onEndpoint(event.target.value)} /></label>
      </div>
      <button className="focus-ring mt-3 rounded-xl bg-purple-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" disabled={!serviceName.trim() || Boolean(busy)} type="button" onClick={onRegister}>{busy === 'register-service' ? <Spinner label="Registering" /> : 'Register service'}</button>
      <div className="mt-4 grid gap-2">
        {services.map((service) => <ServiceRow busy={busy} key={service.name} service={service} onRemove={onRemove} onTest={onTest} />)}
        {!services.length ? <p className="text-sm text-slate-500">No vector services registered.</p> : null}
      </div>
    </div>
  );
}

function ServiceRow({ busy, service, onRemove, onTest }: { busy: string; service: VectorService; onRemove: (name: string) => void; onTest: (name: string) => void }) {
  return (
    <article className="rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-200">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p><span className="font-semibold text-white">{service.name}</span><br /><span className="text-slate-400">{serviceDetail(service)}</span></p>
        <div className="flex gap-2">
          <button className="focus-ring rounded-lg border border-teal-300/30 px-2 py-1 text-xs text-teal-100 disabled:opacity-50" disabled={Boolean(busy)} type="button" onClick={() => onTest(service.name)}>{busy === `service:${service.name}` ? 'Testing…' : 'Test'}</button>
          <button className="focus-ring rounded-lg border border-red-300/30 px-2 py-1 text-xs text-red-100 disabled:opacity-50" disabled={Boolean(busy)} type="button" onClick={() => onRemove(service.name)}>{busy === `remove:${service.name}` ? 'Removing…' : 'Remove'}</button>
        </div>
      </div>
    </article>
  );
}
