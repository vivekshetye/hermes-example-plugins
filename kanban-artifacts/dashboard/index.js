/**
 * Hermes Kanban Artifact Viewer — Dashboard Plugin
 *
 * Plain IIFE using window.__HERMES_PLUGIN_SDK__ for React + shadcn primitives.
 * Registers at /kanban-artifacts tab.
 *
 * SDK:
 *   window.__HERMES_PLUGINS__.register(name, Component)
 *   window.__HERMES_PLUGIN_SDK__.api.fetchJSON(path)  → /api/plugins/kanban-artifacts/<path>
 *   window.__HERMES_PLUGIN_SDK__.components.*  (Card, Badge, Button, Tabs, etc.)
 *   window.__HERMES_PLUGIN_SDK__.hooks.*  (useState, useEffect, useCallback, useMemo)
 *   window.__HERMES_PLUGIN_SDK__.utils.*  (cn, timeAgo, isoTimeAgo)
 */

(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;

  const { React } = SDK;
  const h = React.createElement;

  const {
    Card, CardContent,
    Badge, Button, Input,
    Label, Select, SelectOption,
    Separator, Tabs, TabsList, TabsTrigger,
  } = SDK.components;

  const { useState, useEffect, useCallback, useMemo, useRef } = SDK.hooks;
  const { cn, timeAgo } = SDK.utils;

  const useI18n = SDK.useI18n || function () {
    return { t: { kanbanArtifacts: null }, locale: "en" };
  };

  function tx(t, path, fallback) {
    let node = t && t.kanbanArtifacts;
    if (node) {
      const parts = path.split(".");
      for (let i = 0; i < parts.length; i++) {
        if (node && typeof node === "object" && parts[i] in node) {
          node = node[parts[i]];
        } else { node = null; break; }
      }
    }
    return (typeof node === "string") ? node : fallback;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function apiFetch(path) {
    // Plugin routes live under /api/plugins/<name>/
    // The session token lives in window.__HERMES_SESSION_TOKEN__ (set by the dashboard SPA).
    // We can't use credentials: 'include' with a cookie that doesn't exist — instead
    // we forward the token explicitly as an Authorization header.
    const url = `/api/plugins/kanban-artifacts${path}`;
    const headers = { "Content-Type": "application/json" };
    const token = window.__HERMES_SESSION_TOKEN__;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await fetch(url, { credentials: "include", headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  function escHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function statusDotClass(status) {
    const map = {
      "todo": "bg-gray-400",
      "in_progress": "bg-blue-500",
      "running": "bg-yellow-500",
      "done": "bg-green-500",
      "completed": "bg-green-500",
      "blocked": "bg-red-500",
    };
    return map[status] || "bg-gray-400";
  }

  function fileIcon(name) {
    const ext = name.split(".").pop().toLowerCase();
    const icons = {
      md: "📝", markdown: "📝", txt: "📄", log: "📄",
      py: "🐍", js: "🟨", ts: "🔷", jsx: "⚛️", tsx: "⚛️",
      html: "🌐", css: "🎨", scss: "🎨",
      json: "📋", yaml: "⚙️", yml: "⚙️", toml: "⚙️",
      png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", svg: "🖼️",
      pdf: "📕",
      zip: "🗜️", tar: "🗜️", gz: "🗜️",
      sh: "📟", bash: "📟",
      sql: "🗃️", csv: "📊",
    };
    return icons[ext] || "📎";
  }

  const CODE_EXTS = new Set([
    "py", "js", "ts", "jsx", "tsx", "html", "css", "scss", "sass",
    "json", "yaml", "yml", "toml", "xml", "sql", "sh", "bash",
    "zsh", "fish", "r", "lua", "pl", "rb", "go", "rs", "c", "cpp",
    "h", "hpp", "java", "kt", "swift", "proto", "graphql", "gql",
    "md", "markdown", "txt", "log", "env",
  ]);

  const LANG_MAP = {
    py: "python", js: "javascript", ts: "typescript",
    jsx: "javascript", tsx: "typescript",
    html: "html", css: "css", scss: "scss",
    json: "json", yaml: "yaml", yml: "yaml",
    xml: "xml", sql: "sql", sh: "bash", bash: "bash",
    md: "markdown", txt: "plaintext", r: "r",
    rb: "ruby", rs: "rust", go: "go",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp",
    java: "java", kt: "kotlin", swift: "swift",
    proto: "protobuf", graphql: "graphql",
  };

  // ── Components ────────────────────────────────────────────────────────────────

  function Spinner({ className }) {
    return h("div", { className: cn("animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent", className) });
  }

  function FileItem({ file, active, onClick }) {
    return h("div", {
      className: cn(
        "flex items-center gap-2 px-3 py-2 cursor-pointer rounded-md text-sm transition-colors",
        active ? "bg-blue-500/20 text-blue-400" : "hover:bg-white/5 text-gray-200"
      ),
      onClick,
    },
      h("span", { className: "text-base" }, fileIcon(file.name)),
      h("span", { className: "flex-1 truncate" }, file.name),
      h("span", { className: "text-gray-500 text-xs shrink-0" }, formatSize(file.size))
    );
  }

  // ── Main App ─────────────────────────────────────────────────────────────────

  function KanbanArtifactsApp() {
    const { t } = useI18n();

    const [boards, setBoards] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [filesCache, setFilesCache] = useState({});
    const [tasksCache, setTasksCache] = useState({});
    const [currentBoard, setCurrentBoard] = useState(null);
    const [currentTask, setCurrentTask] = useState(null);
    const [currentFile, setCurrentFile] = useState(null);
    const [fileContent, setFileContent] = useState(null);
    const [loadingBoards, setLoadingBoards] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [loadingFile, setLoadingFile] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [fileError, setFileError] = useState(null);
    const [expandedBoards, setExpandedBoards] = useState({});

    // Column resizing
    const [colWidths, setColWidths] = useState({ board: 280, file: 220 });
    const [resizing, setResizing] = useState(null); // 'board' | 'file'
    const resizingRef = React.useRef(null);

    const onMouseMove = (e) => {
      if (!resizingRef.current) return;
      e.preventDefault();
      const startX = resizingRef.current.startX;
      const startWidths = resizingRef.current.startWidths;
      const delta = e.clientX - startX;
      const next = { ...startWidths };
      if (resizingRef.current.side === 'board-file') {
        next.board = Math.max(160, startWidths.board + delta);
      } else {
        next.file = Math.max(140, startWidths.file + delta);
      }
      setColWidths(next);
    };
    const onMouseUp = () => {
      setResizing(null);
      resizingRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    const startResize = (side, e) => {
      e.preventDefault();
      resizingRef.current = { startX: e.clientX, startWidths: { ...colWidths }, side };
      setResizing(side);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    // Load boards on mount
    useEffect(() => {
      apiFetch("/boards").then(b => {
        setBoards(b);
        setLoadingBoards(false);
        if (b.length > 0 && !currentBoard) {
          const first = b[0].slug;
          setCurrentBoard(first);
          setExpandedBoards({ [first]: true });
        }
      }).catch(() => setLoadingBoards(false));
    }, []);

    // Load tasks when board changes
    useEffect(() => {
      if (!currentBoard) return;
      if (tasksCache[currentBoard]) { setTasks(tasksCache[currentBoard]); return; }
      apiFetch(`/boards/${currentBoard}/tasks`).then(data => {
        setTasksCache(prev => ({ ...prev, [currentBoard]: data }));
        setTasks(data);
      }).catch(() => setTasks([]));
    }, [currentBoard]);

    // Load files when task changes
    useEffect(() => {
      if (!currentTask) { setCurrentFile(null); setFileContent(null); return; }
      const cached = filesCache[currentTask.id];
      if (cached !== undefined) { setCurrentFile(null); setFileContent(null); return; }

      setLoadingFiles(true);
      setCurrentFile(null);
      setFileContent(null);

      const url = currentTask.workspace_path
        ? `/tasks/${currentTask.id}/files?path=${encodeURIComponent(currentTask.workspace_path)}`
        : `/tasks/${currentTask.id}/files`;

      apiFetch(url).then(files => {
        setFilesCache(prev => ({ ...prev, [currentTask.id]: files }));
        setLoadingFiles(false);
      }).catch(() => { setFilesCache(prev => ({ ...prev, [currentTask.id]: [] })); setLoadingFiles(false); });
    }, [currentTask]);

    // Load file content when file changes
    useEffect(() => {
      if (!currentFile) { setFileContent(null); setFileError(null); return; }
      setLoadingFile(true);
      setFileError(null);
      apiFetch(`/files?path=${encodeURIComponent(currentFile.path)}`)
        .then(data => { setFileContent(data); setLoadingFile(false); })
        .catch(err => { setFileError(String(err)); setLoadingFile(false); });
    }, [currentFile]);

    function toggleBoard(slug) {
      setExpandedBoards(prev => ({ ...prev, [slug]: !prev[slug] }));
      setCurrentBoard(slug);
    }

    function selectTask(task) {
      setCurrentTask(task);
      setCurrentFile(null);
      setFileContent(null);
    }

    function selectFile(file) {
      setCurrentFile(file);
    }

    const filteredTasks = useMemo(() => {
      if (!searchQuery) return tasks;
      const q = searchQuery.toLowerCase();
      return tasks.filter(t =>
        (t.title || "").toLowerCase().includes(q) ||
        (t.id || "").toLowerCase().includes(q)
      );
    }, [tasks, searchQuery]);

    const files = currentTask ? (filesCache[currentTask.id] || []) : [];

    const taskMeta = currentTask ? h("div", { className: "flex items-center gap-2 text-xs text-gray-400 mt-1" },
      h(Badge, { variant: currentTask.status === "done" ? "success" : "secondary", className: "text-xs" }, currentTask.status),
      h("span", null, currentTask.assignee || "unassigned")
    ) : null;

    return h("div", { className: "flex h-full overflow-hidden" },

      // ── Sidebar: boards + tasks ─────────────────────────────────────────────
      h("div", { className: "shrink-0 border-r border-white/10 flex flex-col overflow-hidden", style: { width: colWidths.board } },
        h("div", { className: "p-3 border-b border-white/10" },
          h("div", { className: "font-semibold text-sm text-gray-200 mb-2" }, tx(t, "title", "Kanban Artifacts")),
          h(Input, {
            placeholder: tx(t, "filter", "Filter tasks…"),
            value: searchQuery,
            onChange: e => setSearchQuery(e.target.value),
            className: "h-8 text-xs",
          })
        ),

        h("div", { className: "flex-1 overflow-y-auto p-2" },
          loadingBoards
            ? h("div", { className: "flex justify-center py-8" }, h(Spinner))
            : boards.length === 0
              ? h("p", { className: "text-xs text-gray-500 px-2" }, "No boards found")
              : boards.map(board =>
                  h("div", { key: board.slug, className: "mb-1" },
                    h("div", {
                      className: cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-semibold cursor-pointer",
                        "text-gray-400 hover:text-gray-200 select-none transition-colors",
                        currentBoard === board.slug && "text-gray-200"
                      ),
                      onClick: () => toggleBoard(board.slug)
                    },
                      h("span", { className: "text-gray-500 transition-transform", style: { transform: expandedBoards[board.slug] ? "rotate(90deg)" : "none" } }, "▶"),
                      h("span", null, board.slug)
                    ),
                    expandedBoards[board.slug] && h("div", { className: "mt-1" },
                      filteredTasks.length === 0
                        ? h("p", { className: "text-xs text-gray-600 px-2 py-1" }, "No tasks")
                        : filteredTasks.map(task =>
                            h("div", {
                              key: task.id,
                              className: cn(
                                "flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors",
                                "hover:bg-white/5",
                                currentTask && currentTask.id === task.id && "bg-blue-500/15"
                              ),
                              onClick: () => selectTask(task)
                            },
                              h("span", {
                                className: cn("w-2 h-2 rounded-full mt-0.5 shrink-0", statusDotClass(task.status))
                              }),
                              h("div", { className: "flex-1 min-w-0" },
                                h("div", { className: "text-xs text-gray-300 truncate" }, task.title || "(untitled)"),
                                h("div", { className: "text-gray-600 text-xs truncate" }, task.id)
                              )
                            )
                          )
                    )
                  )
                )
        )
      ),

      // ── Resize handle: board ↔ file ─────────────────────────────────────────
      h("div", {
        className: "shrink-0 flex flex-col items-center justify-center cursor-col-resize group relative",
        style: { width: 6 },
        onMouseDown: e => startResize('board-file', e),
        onClick: e => e.preventDefault(),
      },
        h("div", { className: "w-0.5 h-full bg-white/10 group-hover:bg-blue-400/60 transition-colors" }),
        h("div", {
          className: "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-white/10 group-hover:bg-blue-400/60 transition-colors hidden group-hover:flex items-center justify-center",
          style: { pointerEvents: 'none' },
        },
          h("div", { className: "w-0.5 h-3 rounded-full bg-black/30" })
        )
      ),

      // ── File list ──────────────────────────────────────────────────────────
      h("div", { className: "shrink-0 border-r border-white/10 flex flex-col overflow-hidden", style: { width: colWidths.file } },
        h("div", { className: "p-3 border-b border-white/10" },
          currentTask
            ? h("div", null,
                h("div", { className: "text-sm font-medium text-gray-200 truncate" }, currentTask.title || "(untitled)"),
                taskMeta
              )
            : h("div", { className: "text-xs text-gray-500" }, tx(t, "selectTask", "Select a task"))
        ),

        h("div", { className: "flex-1 overflow-y-auto p-1" },
          !currentTask
            ? h("p", { className: "text-xs text-gray-600 text-center py-8" }, "← Select a task")
            : loadingFiles
              ? h("div", { className: "flex justify-center py-8" }, h(Spinner))
              : files.length === 0
                ? h("p", { className: "text-xs text-gray-600 text-center py-8" }, "No files")
                : files.map(f =>
                    h(FileItem, {
                      key: f.path,
                      file: f,
                      active: currentFile && currentFile.path === f.path,
                      onClick: () => selectFile(f)
                    })
                  )
        )
      ),

      // ── Resize handle: file ↔ preview ────────────────────────────────────────
      h("div", {
        className: "shrink-0 flex flex-col items-center justify-center cursor-col-resize group relative",
        style: { width: 6 },
        onMouseDown: e => startResize('file-preview', e),
        onClick: e => e.preventDefault(),
      },
        h("div", { className: "w-0.5 h-full bg-white/10 group-hover:bg-blue-400/60 transition-colors" }),
        h("div", {
          className: "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-white/10 group-hover:bg-blue-400/60 transition-colors hidden group-hover:flex items-center justify-center",
          style: { pointerEvents: 'none' },
        },
          h("div", { className: "w-0.5 h-3 rounded-full bg-black/30" })
        )
      ),

      // ── File viewer ───────────────────────────────────────────────────────
      h("div", { className: "flex-1 flex flex-col overflow-hidden" },
        currentFile && h("div", { className: "flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/20" },
          h("div", { className: "flex items-center gap-2 min-w-0" },
            h("span", { className: "text-sm" }, fileIcon(currentFile.name)),
            h("span", { className: "text-sm text-gray-200 truncate" }, currentFile.name),
          ),
          h("div", { className: "flex gap-2 shrink-0" },
            h(Button, {
              variant: "ghost",
              size: "sm",
              className: "text-xs h-7",
              onClick: () => {
                const a = document.createElement("a");
                a.href = `/api/plugins/kanban-artifacts/raw?path=${encodeURIComponent(currentFile.path)}`;
                a.download = currentFile.name;
                a.click();
              }
            }, "⬇ Download")
          )
        ),

        h("div", { className: "flex-1 overflow-y-auto" },
          !currentFile
            ? h("div", { className: "flex items-center justify-center h-full text-gray-500 text-sm" },
                "← Select a file to preview"
              )
            : loadingFile
              ? h("div", { className: "flex justify-center items-center h-full" }, h(Spinner))
              : fileError
                ? h("div", { className: "text-red-400 text-sm p-4" }, "Error: " + fileError)
                : fileContent && renderContent(fileContent, currentFile)
        )
      )
    );
  }

  // ── Content renderer ─────────────────────────────────────────────────────────

  function renderContent(data, file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const isMarkdown = ["md", "markdown"].includes(ext);
    const isCode = CODE_EXTS.has(ext);

    // Image
    if (data.mime && data.mime.startsWith("image/")) {
      return h("div", { className: "p-4 flex justify-center" },
        h("img", {
          src: `/api/plugins/kanban-artifacts/raw?path=${encodeURIComponent(file.path)}`,
          alt: file.name,
          className: "max-w-full rounded-lg border border-white/10"
        })
      );
    }

    // Text / code / markdown
    if (data.text !== undefined && data.text !== null) {
      const truncated = data.truncated
        ? h("div", { className: "text-yellow-500 text-xs px-4 pt-3" },
            `⚠ File truncated (${formatSize(data.size)}). Download to view full content.`
          )
        : null;

      if (isMarkdown) {
        // Simple markdown rendering (no external deps in plugin)
        return h("div", { className: "p-4 max-w-3xl" },
          h("div", {
            className: "prose prose-invert prose-sm max-w-none",
            dangerouslySetInnerHTML: { __html: renderMarkdown(data.text) }
          }),
          truncated
        );
      }

      if (isCode) {
        return h("div", { className: "p-4" },
          h("pre", { className: "bg-gray-900 rounded-lg border border-white/10 p-4 overflow-x-auto text-sm" },
            h("code", { className: `language-${LANG_MAP[ext] || ext}` }, data.text)
          ),
          truncated
        );
      }

      // Plain text
      return h("div", { className: "p-4" },
        h("pre", { className: "text-sm text-gray-300 whitespace-pre-wrap break-all font-mono" }, data.text),
        truncated
      );
    }

    // Binary fallback
    return h("div", { className: "flex flex-col items-center justify-center h-full gap-3 text-gray-400" },
      h("div", { className: "text-5xl" }, fileIcon(file.name)),
      h("div", { className: "text-sm" }, file.name),
      h("div", { className: "text-xs text-gray-600" }, `${formatSize(data.size)} · ${data.mime}`),
      h(Button, {
        variant: "outline",
        size: "sm",
        className: "mt-2",
        onClick: () => {
          const a = document.createElement("a");
          a.href = `/api/plugins/kanban-artifacts/raw?path=${encodeURIComponent(file.path)}`;
          a.download = file.name;
          a.click();
        }
      }, "⬇ Download")
    );
  }

  // ── Minimal Markdown renderer (no external deps) ─────────────────────────────

  function renderMarkdown(text) {
    if (!text) return "";
    return text
      // Escape HTML first
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      // Code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code class="language-${lang}">${code.replace(/\n/g, "<br>")}</code></pre>`)
      // Inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Headers
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // Bold / italic
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-400 underline" target="_blank">$1</a>')
      // Blockquote
      .replace(/^> (.+)$/gm, '<blockquote class="border-l-2 border-blue-500 pl-3 italic text-gray-400">$1</blockquote>')
      // HR
      .replace(/^---$/gm, "<hr>")
      // Unordered lists
      .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
      // Wrap consecutive <li> in <ul>
      .replace(/(<li>.*<\/li>\n?)+/g, match => `<ul>${match}</ul>`)
      // Paragraphs (double newlines)
      .replace(/\n\n([^<])/g, "</p><p>$1")
      // Single newlines to <br>
      .replace(/\n/g, "<br>");
  }

  // ── Raw file serving (for images/downloads) ───────────────────────────────────

  // We expose a raw endpoint by adding a route in the plugin_api — for now
  // the Download button uses a direct fetch. We'll add the /raw route next.

  // ── Register ─────────────────────────────────────────────────────────────────

  window.__HERMES_PLUGINS__.register("kanban-artifacts", KanbanArtifactsApp);

})();
