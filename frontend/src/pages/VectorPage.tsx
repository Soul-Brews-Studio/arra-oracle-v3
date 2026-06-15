import { useNavigate } from 'react-router-dom';
import { VectorSearchWidget } from '../components/VectorSearchWidget';
import { vectorResultsPath } from '../routePaths';

export function VectorPage() {
  const navigate = useNavigate();
  return <VectorSearchWidget onOpenResults={(query) => navigate(vectorResultsPath(query))} />;
}
