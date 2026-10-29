--[[
  mcp-reverse :: Cheat Engine plugin
  ---------------------------------------------------------------
  Drop this file into Cheat Engine's `autorun` directory
  (`<CE>/autorun/mcp_bridge.lua`) and the HTTP endpoint on
  127.0.0.1:52736 goes live when CE starts.

  Our native TS tools (ce_attach, ce_aob_scan, ce_pointer_scan,
  ce_read_memory, ce_write_memory, ce_lua, ce_status) talk to this
  bridge over HTTP. No other MCP client is required.

  The surface is intentionally tiny:
    GET  /healthz           -> {"ok":true,"ce":"7.5","attached":<pid|null>}
    POST /tool/attach       {"process":"csgo.exe"|"1234"}
    POST /tool/aobscan      {"pattern":"48 8B ?? ?? ?? ?? ?? E8","max":32}
    POST /tool/readmem      {"address":"0x7FF6ABCD1234","size":256}
    POST /tool/writemem     {"address":"0x7FF6ABCD1234","bytes":"90 90 90 90"}
    POST /tool/pointerscan  {"target":"0x1234ABCD","maxLevel":5,"maxOffset":1024}
    POST /tool/lua          {"code":"print(getProcessIDFromProcessName('x.exe'))"}
--]]

local socket = require("socket")

local MCP_HOST = "127.0.0.1"
local MCP_PORT = 52736

local attached_pid = nil

-- ------------------------------------------------------------------
-- JSON (tiny — just enough for our payloads)
-- ------------------------------------------------------------------
local json = {}
function json.encode(o)
  local t = type(o)
  if t == "nil"     then return "null" end
  if t == "boolean" then return tostring(o) end
  if t == "number"  then return tostring(o) end
  if t == "string"  then return '"' .. o:gsub('"','\\"'):gsub("\n","\\n") .. '"' end
  if t == "table" then
    -- array?
    local n = 0
    for _ in pairs(o) do n = n + 1 end
    local isArr = (#o == n)
    local parts = {}
    if isArr then
      for _,v in ipairs(o) do parts[#parts+1] = json.encode(v) end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      for k,v in pairs(o) do
        parts[#parts+1] = '"' .. tostring(k) .. '":' .. json.encode(v)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end
-- bare-bones decode for small payloads
function json.decode(s)
  s = (s or ""):gsub("^%s+",""):gsub("%s+$","")
  if s == "" then return {} end
  local f, err = loadstring("return " .. s:gsub(":", "="):gsub('"','\''):gsub("null","nil"))
  if f then local ok, r = pcall(f); if ok then return r end end
  return {}
end

-- ------------------------------------------------------------------
-- CE primitives
-- ------------------------------------------------------------------
local function do_attach(process)
  local pid
  if tonumber(process) then
    pid = tonumber(process)
  else
    pid = getProcessIDFromProcessName(process)
  end
  if not pid then return nil, "process not found: " .. tostring(process) end
  openProcess(pid)
  attached_pid = pid
  return pid
end

local function do_aobscan(pattern, max)
  if not attached_pid then return nil, "not attached" end
  max = max or 32
  local res = AOBScan(pattern)
  if not res then return {} end
  local hits = {}
  for i = 0, res.Count - 1 do
    if i >= max then break end
    hits[#hits+1] = res[i]
  end
  res.destroy()
  return hits
end

local function do_readmem(addr, size)
  if not attached_pid then return nil, "not attached" end
  size = size or 256
  local bytes = readBytes(addr, size, true)
  if not bytes then return nil, "readBytes failed" end
  local out = {}
  for i, b in ipairs(bytes) do out[i] = string.format("%02X", b) end
  return table.concat(out, " ")
end

local function do_writemem(addr, bytesHex)
  if not attached_pid then return nil, "not attached" end
  local list = {}
  for b in bytesHex:gmatch("%x%x") do list[#list+1] = tonumber(b, 16) end
  writeBytes(addr, list)
  return { wrote = #list, at = addr }
end

local function do_pointerscan(target, maxLevel, maxOffset)
  if not attached_pid then return nil, "not attached" end
  -- CE has a full UI-driven pointer scanner; a programmatic equivalent
  -- is far more code than we want in the bridge. We expose the primitives
  -- and let the caller script the walk via /tool/lua.
  return { note = "use /tool/lua with pointerScanner API", target = target, maxLevel = maxLevel, maxOffset = maxOffset }
end

local function do_lua(code)
  local f, err = loadstring(code)
  if not f then return nil, err end
  local ok, r = pcall(f)
  if not ok then return nil, r end
  return r == nil and "ok" or tostring(r)
end

-- ------------------------------------------------------------------
-- HTTP dispatch
-- ------------------------------------------------------------------
local function dispatch(path, body)
  local p = json.decode(body)
  if path == "/healthz" then
    return 200, { ok = true, ce = getCEVersion and getCEVersion() or "unknown", attached = attached_pid, port = MCP_PORT }
  elseif path == "/ready" then
    return 200, { ready = true, attached = attached_pid }
  elseif path == "/tool/attach" then
    local pid, e = do_attach(p.process); if not pid then return 400, { error = e } end
    return 200, { pid = pid }
  elseif path == "/tool/aobscan" then
    local hits, e = do_aobscan(p.pattern, p.max); if e then return 400, { error = e } end
    return 200, { hits = hits }
  elseif path == "/tool/readmem" then
    local hex, e = do_readmem(tonumber(p.address) or p.address, p.size); if e then return 400, { error = e } end
    return 200, { hex = hex }
  elseif path == "/tool/writemem" then
    local r, e = do_writemem(tonumber(p.address) or p.address, p.bytes); if e then return 400, { error = e } end
    return 200, r
  elseif path == "/tool/pointerscan" then
    return 200, do_pointerscan(p.target, p.maxLevel, p.maxOffset)
  elseif path == "/tool/lua" then
    local r, e = do_lua(p.code); if e then return 400, { error = e } end
    return 200, { result = r }
  end
  return 404, { error = "unknown path: " .. path }
end

-- ------------------------------------------------------------------
-- HTTP server loop (LuaSocket)
-- ------------------------------------------------------------------
local function handle_client(client)
  client:settimeout(5)
  local request_line = client:receive("*l") or ""
  local method, path = request_line:match("^(%u+)%s+(%S+)")
  if not method then client:close(); return end
  local headers, body_len = {}, 0
  while true do
    local line = client:receive("*l") or ""
    if line == "" then break end
    local k, v = line:match("^([^:]+):%s*(.-)$")
    if k then headers[k:lower()] = v end
    local cl = line:lower():match("^content%-length:%s*(%d+)")
    if cl then body_len = tonumber(cl) end
  end
  local body = ""
  if body_len > 0 then body = client:receive(body_len) or "" end
  local status, payload = dispatch(path, body)
  local json_body = json.encode(payload)
  client:send("HTTP/1.1 " .. status .. " OK\r\n")
  client:send("content-type: application/json\r\n")
  client:send("content-length: " .. #json_body .. "\r\n")
  client:send("access-control-allow-origin: *\r\n")
  client:send("access-control-allow-methods: GET,POST,OPTIONS\r\n")
  client:send("access-control-allow-headers: content-type\r\n")
  client:send("connection: close\r\n\r\n")
  client:send(json_body)
  client:close()
end

local srv = socket.bind(MCP_HOST, MCP_PORT)
if srv then
  srv:settimeout(0)
  print(string.format("[mcp-bridge] listening on http://%s:%d", MCP_HOST, MCP_PORT))
  -- CE's main loop invokes the registered timer; we tick the socket there.
  local t = createTimer(nil, false)
  t.Interval = 10
  t.OnTimer = function()
    local client = srv:accept()
    if client then
      local ok, err = pcall(handle_client, client)
      if not ok then print("[mcp-bridge] handler error: " .. tostring(err)) end
    end
  end
  t.Enabled = true
else
  print("[mcp-bridge] FAILED to bind " .. MCP_HOST .. ":" .. MCP_PORT)
end
