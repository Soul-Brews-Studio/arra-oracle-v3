import { useNavigate } from 'react-router-dom';
import { McpToolBrowser } from '../components/McpToolBrowser';
import { mcpToolPath } from '../routePaths';

export function McpPage() {
  const navigate = useNavigate();
  return <McpToolBrowser onOpenTool={(tool) => navigate(mcpToolPath(tool.name))} />;
}
