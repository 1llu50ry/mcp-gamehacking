/** Fetch the raw `tools/list` result from a running server over plain JSON-RPC. */
export async function fetchToolsList(url: string, token: string): Promise<unknown> {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  if (!response.ok) throw new Error(`tools/list answered HTTP ${response.status}`);
  const message = (await response.json()) as { result?: unknown };
  return message.result;
}
