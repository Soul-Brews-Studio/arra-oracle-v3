import { apiClient, type ApiClient, type VectorIndexCollection, type VectorIndexStatusResponse } from '../api/client';
import { VectorIndexPanel } from '../components/VectorIndexPanel';

type VectorIndexClient = Pick<ApiClient, 'startVectorIndex' | 'vectorIndexModels' | 'vectorIndexStatus'>;

export function IndexManagerPanel({
  client = apiClient,
  initialModels,
  initialStatus = null,
}: {
  client?: VectorIndexClient;
  initialModels?: Record<string, VectorIndexCollection>;
  initialStatus?: VectorIndexStatusResponse | null;
}) {
  return <VectorIndexPanel client={client} initialModels={initialModels} initialStatus={initialStatus} />;
}
