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
import { VectorProviderConfigFields } from './VectorProviderConfigFields';
import { VectorStorageSelector } from './VectorStorageSelector';

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
  const selected = providers.find((provider) => provider.type === selectedProvider);

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
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="vector-provider-services-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Provider + service registry</p>
          <h2 id="vector-provider-services-title" className="mt-2 text-2xl font-semibold text-text">Embedding providers and storage services</h2>
          <p className="mt-2 text-sm text-text-muted">Auto-detect embedding providers, test the selected provider, and register proxy vector services.</p>
          <p className="mt-2 text-xs text-text-muted">{availableCount}/{providers.length} providers available · {services.length} services registered</p>
        </div>
        <button className="focus-ring rounded-xl border border-border px-3 py-2 text-sm text-text" type="button" onClick={() => void load()}>Refresh providers</button>
      </div>

      {error ? <div className="mt-4"><ErrorMessage title="Vector provider registry failed." message={error} /></div> : null}
      {message ? <p className="mt-4 rounded-2xl border border-border bg-surface p-3 text-sm text-accent">{message}</p> : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <ProviderSelector providers={providers} selectedProvider={selectedProvider} selected={selected} busy={busy} onSelect={setSelectedProvider} onTest={testProvider} />
        <VectorStorageSelector services={services} />
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

function ProviderSelector({ providers, selectedProvider, selected, busy, onSelect, onTest }: {
  providers: VectorProvider[];
  selectedProvider: string;
  selected?: VectorProvider;
  busy: string;
  onSelect: (provider: string) => void;
  onTest: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-muted p-4">
      <h3 className="font-semibold text-accent">Embedding provider selector</h3>
      <div className="mt-3 grid gap-2">
        {providers.map((provider) => (
          <label key={provider.type} className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-3 text-sm text-text">
            <input type="radio" checked={selectedProvider === provider.type} onChange={() => onSelect(provider.type)} />
            <span><span className="font-semibold text-text">{provider.type}</span><br /><span className="text-text-muted">{providerDetail(provider)}</span></span>
          </label>
        ))}
        {!providers.length ? <p className="text-sm text-text-muted">Provider detection has not returned results yet.</p> : null}
      </div>
      <VectorProviderConfigFields provider={selected} />
      <button className="focus-ring mt-3 rounded-xl bg-accent-solid px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-50" disabled={!selectedProvider || Boolean(busy)} type="button" onClick={onTest}>{busy.startsWith('provider:') ? <Spinner label="Testing" /> : 'Test selected provider'}</button>
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
    <div className="rounded-2xl border border-border bg-surface-muted p-4">
      <h3 className="font-semibold text-accent2">Register vector service</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Name<input className="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={serviceName} onChange={(event) => onName(event.target.value)} /></label>
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Endpoint<input className="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-text" value={serviceEndpoint} onChange={(event) => onEndpoint(event.target.value)} /></label>
      </div>
      <button className="focus-ring mt-3 rounded-xl bg-accent2-solid px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-50" disabled={!serviceName.trim() || Boolean(busy)} type="button" onClick={onRegister}>{busy === 'register-service' ? <Spinner label="Registering" /> : '[+ Register Service]'}</button>
      <div className="mt-4 grid gap-2">
        {services.map((service) => <ServiceRow busy={busy} key={service.name} service={service} onRemove={onRemove} onTest={onTest} />)}
        {!services.length ? <p className="text-sm text-text-muted">No vector services registered.</p> : null}
      </div>
    </div>
  );
}

function ServiceRow({ busy, service, onRemove, onTest }: { busy: string; service: VectorService; onRemove: (name: string) => void; onTest: (name: string) => void }) {
  return (
    <article className="rounded-xl border border-border bg-surface-muted p-3 text-sm text-text">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p><span className="font-semibold text-text">{service.name}</span><br /><span className="text-text-muted">{serviceDetail(service)}</span></p>
        <div className="flex gap-2">
          <button className="focus-ring rounded-lg border border-accent-border px-2 py-1 text-xs text-accent disabled:opacity-50" disabled={Boolean(busy)} type="button" onClick={() => onTest(service.name)}>{busy === `service:${service.name}` ? 'Testing…' : 'Test'}</button>
          <button className="focus-ring rounded-lg border border-err-border/30 px-2 py-1 text-xs text-err-text disabled:opacity-50" disabled={Boolean(busy)} type="button" onClick={() => onRemove(service.name)}>{busy === `remove:${service.name}` ? 'Removing…' : 'Remove'}</button>
        </div>
      </div>
    </article>
  );
}
