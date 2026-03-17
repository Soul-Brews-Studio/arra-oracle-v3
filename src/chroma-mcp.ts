/**
 * ChromaDB MCP Client
 *
 * Uses chroma-mcp (Python) via MCP protocol for embeddings.
 * Pattern copied from claude-mem's ChromaSync service.
 *
 * JS code → MCP Client → chroma-mcp (Python) → ChromaDB
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Parse JSON that may contain Python-style single quotes or numpy arrays */
function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    // Python MCP tools sometimes return single-quoted dicts and numpy arrays
    let fixed = text;

    // Remove numpy array(...) wrappers → just the inner list
    // array([[1,2],[3,4]]) → [[1,2],[3,4]]
    fixed = fixed.replace(/\barray\(/g, '');
    // Now fix orphan ) after ]] — e.g. ]]), → ]],
    fixed = fixed.replace(/\]\]\)/g, ']]');

    // Handle numpy truncation ellipsis: [..., 0.1, ..., 0.2] → remove ... entries
    fixed = fixed.replace(/\.\.\.,\s*/g, '');

    // Python → JSON conversions
    // Only replace single quotes used as JSON structural delimiters, not apostrophes in content
    fixed = fixed
      .replace(/(\{|\[|,\s*)'/g, '$1"')
      .replace(/'(\s*[:,\}\]])/g, '"$1')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');

    return JSON.parse(fixed);
  }
}

interface ChromaDocument {
  id: string;
  document: string;
  metadata: Record<string, string | number>;
}

export class ChromaMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected: boolean = false;
  private collectionName: string;
  private dataDir: string;
  private pythonVersion: string;

  constructor(collectionName: string, dataDir: string, pythonVersion: string = '3.12') {
    this.collectionName = collectionName;
    this.dataDir = dataDir;
    this.pythonVersion = pythonVersion;
  }

  /**
   * Ensure MCP client is connected to Chroma server
   * Pattern from claude-mem: ensureConnection()
   */
  async connect(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    console.log('Connecting to chroma-mcp server...');
    const timeout = parseInt(process.env.ORACLE_CHROMA_TIMEOUT || '10000', 10);

    try {
      this.transport = new StdioClientTransport({
        command: 'uvx',
        args: [
          '--python', this.pythonVersion,
          'chroma-mcp',
          '--client-type', 'persistent',
          '--data-dir', this.dataDir
        ],
        stderr: 'ignore'
      });

      this.client = new Client({
        name: 'arra-oracle-chroma',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      await Promise.race([
        this.client.connect(this.transport),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Chroma connection timeout (${timeout}ms)`)), timeout)
        ),
      ]);
      this.connected = true;

      console.log('Connected to chroma-mcp server');
    } catch (error) {
      this.resetConnection();
      throw new Error(`Chroma connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reset connection state
   */
  private resetConnection(): void {
    this.connected = false;
    this.client = null;
    this.transport = null;
  }

  /**
   * Close connection and cleanup subprocess
   * Pattern from claude-mem: close()
   */
  async close(): Promise<void> {
    if (!this.connected && !this.client && !this.transport) {
      return;
    }

    // Close client first
    if (this.client) {
      try {
        await this.client.close();
      } catch (e) {
        console.warn('[ChromaMCP] client.close() error:', e instanceof Error ? e.message : String(e));
      }
    }

    // Explicitly close transport to kill subprocess
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (e) {
        console.warn('[ChromaMCP] transport.close() error:', e instanceof Error ? e.message : String(e));
      }
    }

    console.log('Chroma client and subprocess closed');
    this.resetConnection();
  }

  /**
   * Ensure collection exists
   */
  async ensureCollection(): Promise<void> {
    await this.connect();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    try {
      // Try to get collection info
      await this.client.callTool({
        name: 'chroma_get_collection_info',
        arguments: {
          collection_name: this.collectionName
        }
      });
      console.log(`Collection '${this.collectionName}' exists`);
    } catch (error) {
      // Collection may not exist — or this could be a connection error
      console.warn('[ChromaMCP] ensureCollection get failed, attempting create:', error instanceof Error ? error.message : String(error));
      console.log(`Creating collection '${this.collectionName}'...`);
      await this.client.callTool({
        name: 'chroma_create_collection',
        arguments: {
          collection_name: this.collectionName,
          embedding_function_name: 'default'
        }
      });
      console.log(`Collection '${this.collectionName}' created`);
    }
  }

  /**
   * Delete collection if exists
   */
  async deleteCollection(): Promise<void> {
    await this.connect();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    try {
      await this.client.callTool({
        name: 'chroma_delete_collection',
        arguments: {
          collection_name: this.collectionName
        }
      });
      console.log(`Collection '${this.collectionName}' deleted`);
    } catch (error) {
      console.warn('[ChromaMCP] deleteCollection failed (may not exist):', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Add documents to collection in batch
   */
  async addDocuments(documents: ChromaDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    await this.ensureCollection();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    await this.client.callTool({
      name: 'chroma_add_documents',
      arguments: {
        collection_name: this.collectionName,
        documents: documents.map(d => d.document),
        ids: documents.map(d => d.id),
        metadatas: documents.map(d => d.metadata)
      }
    });

    console.log(`Added ${documents.length} documents to collection`);
  }

  /**
   * Query collection for semantic search
   * Pattern from claude-mem: queryChroma()
   */
  async query(
    queryText: string,
    limit: number = 10,
    whereFilter?: Record<string, any>
  ): Promise<{ ids: string[]; documents: string[]; distances: number[]; metadatas: any[] }> {
    // Reconnect if connection died
    try {
      await this.connect();
    } catch (error) {
      // Reset and retry once
      this.resetConnection();
      await this.connect();
    }

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    const args: any = {
      collection_name: this.collectionName,
      query_texts: [queryText],
      n_results: limit,
      include: ['documents', 'metadatas', 'distances']
    };

    if (whereFilter) {
      args.where = JSON.stringify(whereFilter);
    }

    let result;
    try {
      result = await this.client.callTool({
        name: 'chroma_query_documents',
        arguments: args
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Not connected')) {
        // Reconnect and retry
        console.log('Connection lost, reconnecting...');
        this.resetConnection();
        await this.connect();
        result = await this.client!.callTool({
          name: 'chroma_query_documents',
          arguments: args
        });
      } else {
        throw error;
      }
    }

    const content = result.content as Array<{ type: string; text?: string }>;
    const data = content[0];
    if (data.type !== 'text' || !data.text) {
      throw new Error('Unexpected response type');
    }

    const parsed = safeJsonParse(data.text);

    return {
      ids: parsed.ids?.[0] || [],
      documents: parsed.documents?.[0] || [],
      distances: parsed.distances?.[0] || [],
      metadatas: parsed.metadatas?.[0] || []
    };
  }

  /**
   * Get collection stats
   */
  async getStats(): Promise<{ count: number }> {
    await this.connect();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    try {
      // Use chroma_get_collection_count — returns a simple number,
      // unlike chroma_get_collection_info which includes numpy arrays
      // that break JSON parsing
      const result = await this.client.callTool({
        name: 'chroma_get_collection_count',
        arguments: {
          collection_name: this.collectionName
        }
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? '0';
      // Response may be just a number or a JSON with count field
      const count = parseInt(text, 10) || (() => {
        try {
          return safeJsonParse(text).count ?? 0;
        } catch {
          return 0;
        }
      })();
      return { count };
    } catch (error) {
      console.warn('[ChromaMCP] getStats failed:', error instanceof Error ? error.message : String(error));
      return { count: 0 };
    }
  }

  /**
   * Query by document ID to find similar documents (nearest neighbors)
   */
  async queryById(
    docId: string,
    nResults: number = 5
  ): Promise<{ ids: string[]; documents: string[]; distances: number[]; metadatas: any[] }> {
    // First get the document's embedding, then query by it
    await this.connect();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    // Get the document's embedding
    const getResult = await this.client.callTool({
      name: 'chroma_get_documents',
      arguments: {
        collection_name: this.collectionName,
        ids: [docId],
        include: ['embeddings', 'documents', 'metadatas']
      }
    });

    const getContent = getResult.content as Array<{ type: string; text?: string }>;
    const getData = getContent[0];
    if (getData.type !== 'text' || !getData.text) {
      throw new Error('Failed to get document embedding');
    }

    const getParsed = safeJsonParse(getData.text);
    const embeddings = getParsed.embeddings?.[0];
    if (!embeddings || embeddings.length === 0) {
      throw new Error(`No embedding found for document: ${docId}`);
    }

    // Query using the embedding vector (request nResults+1 to exclude self)
    const queryResult = await this.client.callTool({
      name: 'chroma_query_documents',
      arguments: {
        collection_name: this.collectionName,
        query_embeddings: [embeddings],
        n_results: nResults + 1,
        include: ['documents', 'metadatas', 'distances']
      }
    });

    const queryContent = queryResult.content as Array<{ type: string; text?: string }>;
    const queryData = queryContent[0];
    if (queryData.type !== 'text' || !queryData.text) {
      throw new Error('Unexpected response type from query');
    }

    const queryParsed = safeJsonParse(queryData.text);
    const ids = queryParsed.ids?.[0] || [];
    const documents = queryParsed.documents?.[0] || [];
    const distances = queryParsed.distances?.[0] || [];
    const metadatas = queryParsed.metadatas?.[0] || [];

    // Filter out the source document itself
    const filtered = ids.reduce((acc: any, id: string, i: number) => {
      if (id !== docId) {
        acc.ids.push(id);
        acc.documents.push(documents[i]);
        acc.distances.push(distances[i]);
        acc.metadatas.push(metadatas[i]);
      }
      return acc;
    }, { ids: [], documents: [], distances: [], metadatas: [] });

    // Trim to requested count
    return {
      ids: filtered.ids.slice(0, nResults),
      documents: filtered.documents.slice(0, nResults),
      distances: filtered.distances.slice(0, nResults),
      metadatas: filtered.metadatas.slice(0, nResults)
    };
  }

  /**
   * Get collection info including count and metadata
   */
  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    await this.connect();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    try {
      const result = await this.client.callTool({
        name: 'chroma_get_collection_info',
        arguments: {
          collection_name: this.collectionName
        }
      });

      const content = result.content as Array<{ type: string; text?: string }>;
      const data = content[0];
      if (data.type !== 'text' || !data.text) {
        return { count: 0, name: this.collectionName };
      }

      const parsed = safeJsonParse(data.text);
      return {
        count: parsed.count || 0,
        name: this.collectionName
      };
    } catch (error) {
      console.warn('[ChromaMCP] getCollectionInfo failed:', error instanceof Error ? error.message : String(error));
      return { count: 0, name: this.collectionName };
    }
  }

  /**
   * Get all document embeddings for PCA/projection
   * Returns IDs and their embedding vectors
   */
  async getAllEmbeddings(limit: number = 5000): Promise<{
    ids: string[];
    embeddings: number[][];
    metadatas: any[];
  }> {
    await this.connect();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    const result = await this.client.callTool({
      name: 'chroma_get_documents',
      arguments: {
        collection_name: this.collectionName,
        limit,
        include: ['embeddings', 'metadatas']
      }
    });

    const content = result.content as Array<{ type: string; text?: string }>;
    const data = content[0];
    if (data.type !== 'text' || !data.text) {
      return { ids: [], embeddings: [], metadatas: [] };
    }

    const parsed = safeJsonParse(data.text);
    return {
      ids: parsed.ids || [],
      embeddings: parsed.embeddings || [],
      metadatas: parsed.metadatas || []
    };
  }
}
