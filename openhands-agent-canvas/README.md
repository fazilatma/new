# OpenHands Agent Canvas — WebConsole project

This folder is intentionally structured as a normal Node.js project so WebConsole Pro can import and run it as a project.

## WebConsole settings

- Type: Node.js
- Node version: 24
- Port: 8000
- Install command: npm install --no-audit --no-fund
- Start command: npm start
- Daemon: enabled
- Auto start: disabled by default

The launcher uses OpenHands Agent Canvas public mode and creates a persistent random API key in `.openhands-backend-key` at first start. The key is never committed because it is listed in `.gitignore`.

## Requirements

- Node.js 24+
- npm
- uv available in the hosting account PATH

OpenHands Agent Canvas runs the agent server directly on the host, so it has the same filesystem and command execution privileges as the hosting account. Do not expose it publicly without the API-key protection provided by `--public`.

## Access

When WebConsole publishes this project through a domain, use that domain as the public URL. The first page will ask for the generated backend API key. The key is stored only on the hosting account in `.openhands-backend-key`.

For a local terminal, the key can be displayed with:

```bash
cat .openhands-backend-key
```
