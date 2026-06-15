import { Component, type ErrorInfo, type ReactNode } from 'react';

export type ErrorReportStatus = 'idle' | 'reporting' | 'reported' | 'failed';
export type ErrorReporter = (error: Error, info: ErrorInfo, retryCount: number) => Promise<boolean> | boolean;

export interface ErrorBoundaryProps {
  children: ReactNode;
  reporter?: ErrorReporter;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  retryCount: number;
  reportStatus: ErrorReportStatus;
}

export interface ErrorBoundaryFallbackProps {
  error: Error;
  componentStack?: string;
  retryCount: number;
  reportStatus: ErrorReportStatus;
  onRetry: () => void;
}

const initialState: ErrorBoundaryState = {
  error: null,
  componentStack: '',
  retryCount: 0,
  reportStatus: 'idle',
};

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function locationHref(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.href;
}

function userAgent(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.userAgent;
}

export async function reportErrorToMetrics(
  error: Error,
  info: Pick<ErrorInfo, 'componentStack'>,
  retryCount = 0,
  fetcher: typeof fetch | undefined = globalThis.fetch?.bind(globalThis),
): Promise<boolean> {
  if (!fetcher) return false;
  const payload = {
    source: 'frontend-error-boundary',
    name: error.name,
    message: error.message,
    stack: error.stack,
    componentStack: info.componentStack ?? '',
    retryCount,
    url: locationHref(),
    userAgent: userAgent(),
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetcher('/api/metrics', {
      method: 'POST',
      keepalive: true,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-arra-report': 'frontend-error-boundary',
      },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function ErrorBoundaryFallback({
  error,
  componentStack,
  retryCount,
  reportStatus,
  onRetry,
}: ErrorBoundaryFallbackProps) {
  return (
    <main className="oracle-shell min-h-screen p-6 text-slate-100">
      <section className="mx-auto max-w-2xl rounded-3xl border border-red-400/30 bg-red-950/50 p-6 shadow-2xl shadow-black/30" role="alert">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-200">Frontend error boundary</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">The dashboard hit a rendering error.</h1>
        <p className="mt-3 text-red-100/80">{error.message || 'Unknown rendering error'}</p>
        <p className="mt-4 text-sm text-red-100/70">Report status: {reportStatus}</p>
        <p className="mt-1 text-sm text-red-100/70">Auto-retry attempts: {retryCount}</p>
        {componentStack ? <pre className="mt-4 max-h-48 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-red-50/80">{componentStack}</pre> : null}
        <button
          aria-label="Auto-retry rendering after error"
          className="mt-5 rounded-xl bg-teal-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-teal-200"
          type="button"
          onClick={onRetry}
        >
          Auto-retry
        </button>
      </section>
    </main>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = initialState;

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: normalizeError(error), reportStatus: 'idle' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const normalized = normalizeError(error);
    this.setState({ componentStack: info.componentStack ?? '', reportStatus: 'reporting' });
    void this.report(normalized, info);
  }

  private async report(error: Error, info: ErrorInfo): Promise<void> {
    const reporter = this.props.reporter ?? reportErrorToMetrics;
    const ok = await reporter(error, info, this.state.retryCount);
    this.setState((state) => {
      if (state.error !== error && state.error?.message !== error.message) return state;
      return { ...state, reportStatus: ok ? 'reported' : 'failed' };
    });
  }

  private retry = (): void => {
    this.setState((state) => ({
      ...initialState,
      retryCount: state.retryCount + 1,
    }));
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorBoundaryFallback
        error={this.state.error}
        componentStack={this.state.componentStack}
        retryCount={this.state.retryCount}
        reportStatus={this.state.reportStatus}
        onRetry={this.retry}
      />
    );
  }
}
