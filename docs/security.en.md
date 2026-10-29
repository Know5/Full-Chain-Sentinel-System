# Authorized use and security boundaries

[Home](../README.en.md) · [简体中文](security.md)

**Contents**

- [Authorized use](#section-1)
- [Security boundaries](#section-2)
- [Gateway and proxy boundaries](#section-3)

---

<a id="section-1"></a>

## Authorized use

This project is an offensive security tool. **Use it only against targets for which you hold written authorization.**

- Unauthorized penetration testing, vulnerability scanning, password cracking, or intrusion against systems you do not own or have permission to test is illegal in mainland China and most other jurisdictions (see Article 27 of the Cybersecurity Law of the PRC and Articles 285, 286, and 287-2 of the Criminal Law of the PRC; this paragraph is not legal advice).
- On first entering the console you must accept "I promise to use this only for authorized and lawful penetration testing". A hash of the acceptance and the statement is stored in the local configuration directory. Updating the statement or switching accounts requires accepting it again.
- Agent behavior cannot be fully controlled: in Auto mode the model can run arbitrary commands. **You are responsible for any business interruption, data damage, unauthorized access, or other consequences caused by using this project.** The authors and contributors accept no liability.
- Use it within the authorized scope and in an isolated environment. Obtain written authorization and agree on a time window before testing production systems.

This project is released under the MIT License, without warranty of any kind.

<a id="section-2"></a>

## Security boundaries

**Console**: Docker is required. Each new project has a Kali work container (`sentinel:latest`) and a persistent gateway. Bash runs in the work container through `docker exec`; the project directory is bind-mounted at `/work` and commands run as root. The work container has `NET_RAW`, while the gateway has `NET_ADMIN` and `NET_RAW`. The gateway uses an isolated Docker bridge for both direct and proxied access. Blocking Docker-check failures prevent `prompt`, `compact`, and persistent goals. See [Project gateway](../packages/web/docs/project-gateway.md) (Chinese).

**The container constrains commands, not the whole process**: the console and agent processes run as the starting user on the host. Only commands enter the container.

- The approval chain covers bash, Android shell (`droid_shell`), and iOS shell (`ios_shell`); subagent bash uses the same chain. **read/edit/write, the file panel, MCP tools, codemode, and tools that call the container directly (Frida, packet capture, APK analysis, and similar) bypass the gate.** Engagement-task bash has a separate regex blacklist, a 20-second timeout, and a 40-command budget, and also bypasses approval.
- `read/edit/write` access the host filesystem directly. The project directory is only the base for relative paths; absolute paths are unrestricted. MCP stdio servers are host subprocesses.
- AI Approval (the Gatekeeper) judges only six classes of destructive operations. Failures, timeouts, and unparseable replies fail open. It is **not a sandbox and does not prevent data leakage**.
- The container runs as root with no resource limits and no cap-drop / seccomp / read-only hardening. All sessions and concurrent tasks in a project share one container.
- The console loads `settings.json`, `.pi/extensions`, and `AGENTS.md` from the project directory without a project-trust confirmation step. Do not use an untrusted directory as a project. MCP servers are not loaded this way: they come only from Settings → MCP. Neither `.pi/mcp.json` in the project nor `mcp.json` in the configuration directory is read.
- **Custom MCP stdio servers execute directly on the console host**: outside the container and without bash approval or Gatekeeper review, so each one requires an explicit risk acknowledgement before saving. For HTTP servers that need OAuth login, run `sentinel mcp login` in a terminal.
- **Web search sends search terms and the API key to Tavily**: requests go directly over HTTPS from the console process, bypassing the approval gate and the container. Search content is visible to Tavily. Multiple keys are stored in plaintext in the local `websearch.json` (mode 0600) and are never displayed in the frontend. Query history and raw responses stay local (`websearch.db` and the project's `evidence/search/`).
- **Folder packaging reads the whole /work subtree**: packaging runs as root in the project container, so hidden files and dot-directories are included. Symlinks are stored as links and not followed, which keeps files outside /work out of the archive. There is no size cap; a huge folder consumes the server's temp disk and CPU. The temp `.tar.gz` lives under `downloads/` in the config directory (mode 0600), is deleted after the download or 10 minutes, and leftovers are cleaned on restart.
- **The asset library stays local**: assets and test records are written to `asset-library.db` on the console host, and the tools make no outbound requests. There is no cap on assets or records; lists are paginated and exports are complete. Exported Markdown may contain internal domains and tokens in URL queries, so treat it as sensitive; deleting a project removes the records with it.
- **Asset discovery sends queries and the API key to third-party platforms** (FOFA / 360 Quake / QiAnXin Hunter): queries go directly over HTTPS from the console process, bypassing the approval gate and the container, but target domains, IPs, and other query content are visible to those platforms. Keys are stored in plaintext in the local configuration directory's `assets.json` (mode 0600) and are never displayed in the frontend. Query history and raw responses stay local (`assets.db` and the project's `evidence/asset/`). With a custom base URL, the API key and query content are sent to that address, so only use a trusted reverse proxy.

For the complete boundaries and configuration, see [packages/web/README.md](../packages/web/README.md#安全提示).

In Auto mode the model can run arbitrary commands, and persistent goals have no dangerous-command blacklist in Auto mode either. Use it only against **authorized targets in an isolated environment**. If you need unattended operation without allowing everything, use AI Approval. Console login, the random entry string, and the authorization consent prevent misuse and scanning; they are not isolation.

Report security issues through a repository issue. Do not include directly exploitable details in a public issue.

<a id="section-3"></a>

## Gateway and proxy boundaries

Proxy operators can observe traffic sent through their exit; use trusted profiles only. Profile credentials are mounted only in the gateway. Its authenticated Clash API shares loopback with the work container; sharing a network namespace does not isolate the work container from gateway services. Changing proxies replaces clients inside the persistent gateway; do not restart the gateway container separately because running work containers would retain the old namespace. Listeners are not published automatically, and `host.docker.internal` reaches the host. Existing projects require an explicit rebuild to migrate; back up files outside `/work` first. See [Project gateway](../packages/web/docs/project-gateway.md) (Chinese).
