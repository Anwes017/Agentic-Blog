from __future__ import annotations

import asyncio
import json
import os
import sys
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


class MCPError(RuntimeError):
    pass


@dataclass
class MCPResult:
    content: Any
    raw: Dict[str, Any]


ROOT_DIR = Path(__file__).resolve().parents[1]


def _load_adapter():
    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
        from langchain_mcp_adapters.tools import load_mcp_tools
    except Exception as exc:  # pragma: no cover - import guard
        raise MCPError(
            "The `langchain-mcp-adapters` package is required. Install it with `pip install langchain-mcp-adapters`."
        ) from exc
    return MultiServerMCPClient, load_mcp_tools


def _server_configs() -> Dict[str, Dict[str, Any]]:
    # Build the two MCP connections we care about for sharing: Gmail and Slack.
    servers: Dict[str, Dict[str, Any]] = {}
    for name in ("gmail", "slack"):
        default_server_file = ROOT_DIR / "mcp_servers" / f"{name}_server.py"
        command = (os.getenv(f"{name.upper()}_MCP_COMMAND") or sys.executable).strip()
        args_raw = (os.getenv(f"{name.upper()}_MCP_ARGS") or "").strip()
        args = shlex.split(args_raw) if args_raw else [str(default_server_file)]
        servers[name] = {
            "transport": "stdio",
            "command": command,
            "args": args,
            "env": dict(os.environ),
        }
    return servers


def _to_jsonable(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, dict):
        return value
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


def _tool_name(tool: Any) -> Optional[str]:
    return getattr(tool, "name", None) or (tool.get("name") if isinstance(tool, dict) else None)


async def _list_tools_async(server_name: str) -> List[Dict[str, Any]]:
    MultiServerMCPClient, load_mcp_tools = _load_adapter()
    servers = _server_configs()
    if server_name not in servers:
        raise MCPError(f"Server '{server_name}' is not configured.")

    client = MultiServerMCPClient({server_name: servers[server_name]})
    async with client.session(server_name) as session:
        tools = await load_mcp_tools(session)
        return [
            {
                "name": _tool_name(tool),
                "description": getattr(tool, "description", None),
            }
            for tool in tools
        ]


async def _invoke_async(server_name: str, tool_name: str, arguments: Dict[str, Any]) -> MCPResult:
    MultiServerMCPClient, load_mcp_tools = _load_adapter()
    servers = _server_configs()
    if server_name not in servers:
        raise MCPError(f"Server '{server_name}' is not configured.")

    client = MultiServerMCPClient({server_name: servers[server_name]})
    async with client.session(server_name) as session:
        tools = await load_mcp_tools(session)
        named = {name: tool for tool in tools if (name := _tool_name(tool))}
        if tool_name not in named:
            available = ", ".join(sorted(named)) if named else "none"
            raise MCPError(f"Tool '{tool_name}' was not found on {server_name}. Available tools: {available}")
        result = await named[tool_name].ainvoke(arguments)
        return MCPResult(content=getattr(result, "content", None), raw=_to_jsonable(result))


def list_mcp_tools(server_name: str) -> List[Dict[str, Any]]:
    try:
        return asyncio.run(_list_tools_async(server_name))
    except RuntimeError as exc:
        if "asyncio.run()" in str(exc):
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(_list_tools_async(server_name))
            finally:
                loop.close()
        raise


def invoke_mcp_tool(server_name: str, tool_name: str, arguments: Dict[str, Any]) -> MCPResult:
    try:
        return asyncio.run(_invoke_async(server_name, tool_name, arguments))
    except RuntimeError as exc:
        if "asyncio.run()" in str(exc):
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(_invoke_async(server_name, tool_name, arguments))
            finally:
                loop.close()
        raise
