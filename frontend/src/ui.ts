/**
 * UI — DOM manipulation for transcript, unified timeline, and filters.
 */

import { marked } from "marked";
import type { ClaudeToolUseEvent } from "./types";

// Configure marked for inline rendering
marked.setOptions({ breaks: true });

// Event categories — used for filtering and styling
type EventCategory =
  | "gemini-thinking"
  | "gemini-tool-call"
  | "gemini-tool-result"
  | "gemini-tool-error"
  | "gemini-summarize"
  | "claude-tool"
  | "claude-done"
  | "claude-error"
  | "claude-thinking"
  | "claude-text"
  | "file-change"
  | "status";

// Map visual categories to their filter group
const FILTER_MAP: Record<EventCategory, string> = {
  "gemini-thinking": "gemini-thinking",
  "gemini-tool-call": "gemini-tool-call",
  "gemini-tool-result": "gemini-tool-result",
  "gemini-tool-error": "gemini-tool-result",
  "gemini-summarize": "gemini-tool-result",
  "claude-tool": "claude-tool",
  "claude-done": "claude-tool",
  "claude-error": "claude-tool",
  "claude-thinking": "claude-thinking",
  "claude-text": "claude-tool",
  "file-change": "file-change",
  "status": "status",
};

export class UI {
  private transcriptEl: HTMLElement;
  private timeline: HTMLElement;
  private statusDot: HTMLElement;
  private statusText: HTMLElement;
  private micBtn: HTMLElement;
  private micHint: HTMLElement;
  private connectBtn: HTMLElement;

  // Screens
  private pickerScreen: HTMLElement;
  private voiceScreen: HTMLElement;

  // Picker elements
  private projectPathInput: HTMLInputElement;
  private browserList: HTMLElement;
  private browserHeader: HTMLElement;
  private recentProjectsEl: HTMLElement;
  private projectNameEl: HTMLElement;

  // Skills Modal
  private skillsBtn: HTMLElement;
  private skillsModal: HTMLElement;
  private closeSkillsBtn: HTMLElement;

  // Filter state
  private filters: Record<string, boolean> = {};

  constructor() {
    this.transcriptEl = document.getElementById("transcript")!;
    this.timeline = document.getElementById("timeline")!;
    this.statusDot = document.getElementById("connection-status")!;
    this.statusText = document.getElementById("status-text")!;
    this.micBtn = document.getElementById("mic-btn")!;
    this.micHint = document.getElementById("mic-hint")!;
    this.connectBtn = document.getElementById("connect-btn")!;

    this.pickerScreen = document.getElementById("project-picker")!;
    this.voiceScreen = document.getElementById("voice-screen")!;
    this.projectPathInput = document.getElementById("project-path") as HTMLInputElement;
    this.browserList = document.getElementById("browser-list")!;
    this.browserHeader = document.getElementById("browser-header")!;
    this.recentProjectsEl = document.getElementById("recent-projects")!;
    this.projectNameEl = document.getElementById("project-name")!;
    
    // Canvas elements
    this.canvasContent = document.getElementById("canvas-content")!;
    
    // Skills elements
    this.skillsBtn = document.getElementById("skills-btn")!;
    this.skillsModal = document.getElementById("skills-modal")!;
    this.closeSkillsBtn = document.getElementById("close-skills-btn")!;

    this.initSkillsModal();
    this.initFilters();
  }

  private initSkillsModal(): void {
    if (this.skillsBtn && this.skillsModal && this.closeSkillsBtn) {
      this.skillsBtn.addEventListener("click", () => {
        this.skillsModal.style.display = "flex";
      });
      
      this.closeSkillsBtn.addEventListener("click", () => {
        this.skillsModal.style.display = "none";
      });
      
      this.skillsModal.addEventListener("click", (e) => {
        if (e.target === this.skillsModal) {
          this.skillsModal.style.display = "none";
        }
      });
    }
  }

  private canvasContent: HTMLElement;

  updateLiveCanvas(html: string): void {
    if (this.canvasContent) {
      this.canvasContent.innerHTML = html;
    }
  }

  private initFilters(): void {
    const chips = document.querySelectorAll(".filter-chip");
    chips.forEach((chip) => {
      const filterName = (chip as HTMLElement).dataset.filter!;
      const checkbox = chip.querySelector("input") as HTMLInputElement;
      this.filters[filterName] = checkbox.checked;

      chip.addEventListener("click", (e) => {
        e.preventDefault();
        checkbox.checked = !checkbox.checked;
        this.filters[filterName] = checkbox.checked;
        chip.classList.toggle("unchecked", !checkbox.checked);
        this.applyFilters();
      });
    });
  }

  private applyFilters(): void {
    const entries = this.timeline.querySelectorAll(".tl-entry");
    entries.forEach((entry) => {
      const cat = (entry as HTMLElement).dataset.category as EventCategory;
      const filterGroup = FILTER_MAP[cat] || cat;
      const visible = this.filters[filterGroup] !== false;
      (entry as HTMLElement).style.display = visible ? "" : "none";
    });
  }

  onConnectClick(handler: () => void): void {
    this.connectBtn.addEventListener("click", handler);
  }

  // ── Project Picker ─────────────────────────────────────────

  showProjectPicker(): void {
    this.pickerScreen.style.display = "flex";
    this.voiceScreen.style.display = "none";
    this.renderRecentProjects();
    this.projectPathInput.focus();
  }

  showVoiceScreen(projectPath: string): void {
    this.pickerScreen.style.display = "none";
    this.voiceScreen.style.display = "flex";

    const name = projectPath.split(/[/\\]/).pop() || projectPath;
    this.projectNameEl.textContent = name;
    this.projectNameEl.title = projectPath;

    this.addRecentProject(projectPath);
  }

  onOpenProject(handler: (path: string) => void): void {
    const openBtn = document.getElementById("open-btn")!;
    const input = this.projectPathInput;

    const submit = () => {
      const path = input.value.trim();
      if (path) handler(path);
    };

    openBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  onBrowseNative(handler: () => void): void {
    document.getElementById("browse-btn")!.addEventListener("click", handler);
  }

  onChangeProject(handler: () => void): void {
    document.getElementById("change-project-btn")!.addEventListener("click", handler);
  }

  onBrowseDir(handler: (path: string) => void): void {
    this.browserList.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest("[data-path]") as HTMLElement | null;
      if (target?.dataset.path) handler(target.dataset.path);
    });
    this.browserHeader.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest("[data-path]") as HTMLElement | null;
      if (target?.dataset.path) handler(target.dataset.path);
    });
  }

  onSelectDir(handler: (path: string) => void): void {
    this.browserList.addEventListener("dblclick", (e) => {
      const target = (e.target as HTMLElement).closest("[data-path]") as HTMLElement | null;
      if (target?.dataset.path) handler(target.dataset.path);
    });
  }

  onRecentClick(handler: (path: string) => void): void {
    this.recentProjectsEl.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest("[data-path]") as HTMLElement | null;
      if (target?.dataset.path) handler(target.dataset.path);
    });
  }

  renderFolderBrowser(current: string, parent: string, dirs: { name: string; path: string }[]): void {
    this.projectPathInput.value = current;

    this.browserHeader.innerHTML = `<button class="browser-up" data-path="${escapeAttr(parent)}">&#8593; Up</button>
      <span class="browser-current">${escapeHtml(current)}</span>`;

    this.browserList.innerHTML = dirs
      .map(
        (d) =>
          `<div class="browser-dir" data-path="${escapeAttr(d.path)}">&#128193; ${escapeHtml(d.name)}</div>`
      )
      .join("");
  }

  setPickerError(msg: string): void {
    this.projectPathInput.classList.add("input-error");
    this.projectPathInput.placeholder = msg;
    setTimeout(() => {
      this.projectPathInput.classList.remove("input-error");
      this.projectPathInput.placeholder = "/path/to/your/project";
    }, 2000);
  }

  private renderRecentProjects(): void {
    const recent = this.getRecentProjects();
    if (recent.length === 0) {
      this.recentProjectsEl.innerHTML = "";
      return;
    }
    this.recentProjectsEl.innerHTML =
      `<h3>Recent Projects</h3>` +
      recent
        .map((p) => {
          const name = p.split(/[/\\]/).pop() || p;
          return `<div class="recent-entry" data-path="${escapeAttr(p)}">
            <span class="recent-name">${escapeHtml(name)}</span>
            <span class="recent-path">${escapeHtml(p)}</span>
          </div>`;
        })
        .join("");
  }

  private addRecentProject(path: string): void {
    const recent = this.getRecentProjects().filter((p) => p !== path);
    recent.unshift(path);
    localStorage.setItem("voicecode_recent", JSON.stringify(recent.slice(0, 10)));
  }

  private getRecentProjects(): string[] {
    try {
      return JSON.parse(localStorage.getItem("voicecode_recent") || "[]");
    } catch {
      return [];
    }
  }

  // ── Status ──────────────────────────────────────────────────

  setConnected(connected: boolean): void {
    this.statusDot.className = `status-dot ${connected ? "connected" : "disconnected"}`;
    this.statusText.textContent = connected ? "Connected" : "Disconnected";
    this.connectBtn.textContent = connected ? "Disconnect" : "Connect";
  }

  setClaudeWorking(working: boolean): void {
    if (working) {
      this.statusText.textContent = "Claude working...";
      this.statusDot.className = "status-dot recording";
    } else {
      this.statusText.textContent = "Connected";
      this.statusDot.className = "status-dot connected";
    }
  }

  setGeminiState(state: "idle" | "thinking" | "speaking" | "listening"): void {
    const labels: Record<string, string> = {
      idle: "Ready",
      thinking: "Thinking...",
      speaking: "Speaking...",
      listening: "Listening...",
    };
    const dotClass: Record<string, string> = {
      idle: "connected",
      thinking: "thinking",
      speaking: "speaking",
      listening: "recording",
    };
    this.statusText.textContent = labels[state];
    this.statusDot.className = `status-dot ${dotClass[state]}`;
  }

  // ── Transcript ──────────────────────────────────────────────

  private lastTranscriptRole: "user" | "gemini" | "narrator" | null = null;
  private lastTranscriptEl: HTMLElement | null = null;
  private lastTranscriptText = "";

  addTranscript(role: "user" | "gemini" | "narrator", text: string): void {
    if (role === this.lastTranscriptRole && this.lastTranscriptEl) {
      this.lastTranscriptText += text;
      const textSpan = this.lastTranscriptEl.querySelector(".transcript-text");
      if (textSpan) {
        textSpan.textContent = this.lastTranscriptText;
      }
    } else {
      const entry = document.createElement("div");
      entry.className = `transcript-entry transcript-${role}`;
      const roleLabels: Record<string, string> = { user: "You", gemini: "Jarvis", narrator: "Jarvis (Thinking)" };
      const roleLabel = roleLabels[role] || role;
      entry.innerHTML = `<span class="role">${roleLabel}:</span> <span class="transcript-text">${escapeHtml(text)}</span>`;

      this.transcriptEl.appendChild(entry);
      this.lastTranscriptRole = role;
      this.lastTranscriptEl = entry;
      this.lastTranscriptText = text;
    }

    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
  }

  endTranscript(): void {
    this.lastTranscriptRole = null;
    this.lastTranscriptEl = null;
    this.lastTranscriptText = "";
  }

  replaceLastUserTranscript(text: string): void {
    const entries = this.transcriptEl.querySelectorAll(".transcript-user");
    const last = entries[entries.length - 1];
    if (last) {
      const textSpan = last.querySelector(".transcript-text");
      if (textSpan) {
        textSpan.textContent = text;
        last.classList.remove("transcript-draft");
      }
    }
  }

  markLastAsDraft(): void {
    if (this.lastTranscriptEl && this.lastTranscriptRole === "user") {
      this.lastTranscriptEl.classList.add("transcript-draft");
    }
  }

  // ── Unified Timeline ──────────────────────────────────────

  private appendTimeline(category: EventCategory, tag: string, detail: string, renderMarkdown = false): void {
    const entry = document.createElement("div");
    entry.className = `tl-entry cat-${category}`;
    entry.dataset.category = category;

    const time = this.timeStamp();
    const filterGroup = FILTER_MAP[category] || category;
    const visible = this.filters[filterGroup] !== false;
    if (!visible) entry.style.display = "none";

    if (renderMarkdown && looksLikeMarkdown(detail)) {
      const rendered = marked.parse(detail) as string;
      entry.innerHTML = `<span class="tl-time">${time}</span> <span class="tl-tag">${escapeHtml(tag)}</span> <span class="tl-detail md-content">${rendered}</span>`;
    } else {
      entry.innerHTML = `<span class="tl-time">${time}</span> <span class="tl-tag">${escapeHtml(tag)}</span> <span class="tl-detail">${escapeHtml(detail)}</span>`;
    }

    this.timeline.appendChild(entry);
    this.timeline.scrollTop = this.timeline.scrollHeight;
  }

  private timeStamp(): string {
    return new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  // Gemini events
  addGeminiThinking(text: string): void {
    this.appendTimeline("gemini-thinking", "Thinking", text);
  }

  addGeminiToolCall(name: string, args: Record<string, unknown>): void {
    const argsPreview = JSON.stringify(args).slice(0, 120);
    this.appendTimeline("gemini-tool-call", "Tool Call", `${name}(${argsPreview})`);
  }

  addGeminiToolResult(name: string, result: string, isError: boolean): void {
    const cat: EventCategory = isError ? "gemini-tool-error" : "gemini-tool-result";
    const tag = isError ? "Error" : "Result";
    this.appendTimeline(cat, tag, result, true);
  }

  addGeminiSummarize(functionName: string): void {
    this.appendTimeline("gemini-summarize", "Summarizing", `Relaying Claude's ${functionName} response`);
  }

  // Claude events
  addActivityEvent(event: ClaudeToolUseEvent): void {
    const icon = toolIcon(event.tool);
    let detail = "";

    if (event.tool === "Read" || event.tool === "Edit" || event.tool === "Write") {
      detail = (event.input.file_path as string) || event.tool;
    } else if (event.tool === "Bash") {
      detail = ((event.input.command as string) || "").slice(0, 80);
    } else if (event.tool === "Glob" || event.tool === "Grep") {
      detail = (event.input.pattern as string) || "search";
    } else {
      detail = event.tool;
    }

    this.appendTimeline("claude-tool", `${icon} ${event.tool}`, detail);

    // Also add inline diffs for Edit/Write
    if (event.tool === "Edit") {
      this.addDiff(
        (event.input.file_path as string) || "unknown",
        (event.input.old_string as string) || "",
        (event.input.new_string as string) || ""
      );
    } else if (event.tool === "Write") {
      this.addDiff(
        (event.input.file_path as string) || "unknown",
        "",
        (event.input.content as string) || ""
      );
    }
  }

  addActivityDone(isError: boolean): void {
    const cat: EventCategory = isError ? "claude-error" : "claude-done";
    const tag = isError ? "Error" : "Done";
    this.appendTimeline(cat, tag, isError ? "Task failed" : "Task completed");
  }

  addThinking(text: string): void {
    this.appendTimeline("claude-thinking", "Claude Thinking", text, true);
  }

  addClaudeText(text: string): void {
    this.appendTimeline("claude-text", "Claude", text, true);
    
    // Attempt to extract markdown blocks to render in Live Canvas
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/;
    const match = text.match(codeBlockRegex);
    if (match) {
      const language = match[1];
      const code = match[2];
      
      // Render to canvas
      let canvasHtml = `<div class="canvas-header-lang">${language.toUpperCase()} Output</div>`;
      
      if (language.toLowerCase() === 'html' || language.toLowerCase() === 'svg') {
         // Render the actual HTML/SVG if safe, but for now we just show it safely
         // For a true "Live Canvas", rendering raw SVG/HTML is powerful. Let's do it safely or as text
         canvasHtml += `<div class="canvas-render-box">${code}</div>`;
      } else {
         canvasHtml += `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
      this.updateLiveCanvas(canvasHtml);
    } else {
      // Just put the rendered markdown in the canvas as a summary
      const rendered = marked.parse(text) as string;
      this.updateLiveCanvas(`<div class="canvas-md">${rendered}</div>`);
    }
  }

  // Clear all transcript and timeline content
  clearAll(): void {
    this.transcriptEl.innerHTML = "";
    this.timeline.innerHTML = "";
    this.lastTranscriptRole = null;
    this.lastTranscriptEl = null;
    this.lastTranscriptText = "";
  }

  // Status events
  addStatus(message: string): void {
    this.appendTimeline("status", "Status", message);
  }

  // File changes (inline diffs)
  addDiff(filePath: string, oldStr: string, newStr: string): void {
    const entry = document.createElement("div");
    entry.className = "tl-entry cat-file-change";
    entry.dataset.category = "file-change";

    const time = this.timeStamp();
    const filterGroup = FILTER_MAP["file-change"];
    const visible = this.filters[filterGroup] !== false;
    if (!visible) entry.style.display = "none";

    const label = oldStr === "" ? "new" : "modified";

    const lineCount = (oldStr ? oldStr.split("\n").length : 0) + newStr.split("\n").length;

    let diffHtml = `<div class="tl-row"><span class="tl-time">${time}</span> <span class="tl-tag">File ${label}</span> <span class="tl-detail">${escapeHtml(filePath)}</span><button class="tl-diff-toggle">\u25B6 ${lineCount} lines</button></div>`;
    diffHtml += `<div class="tl-diff-body collapsed">`;

    if (oldStr) {
      for (const line of oldStr.split("\n")) {
        diffHtml += `<div class="diff-removed">- ${escapeHtml(line)}</div>`;
      }
    }
    for (const line of newStr.split("\n")) {
      diffHtml += `<div class="diff-added">+ ${escapeHtml(line)}</div>`;
    }
    diffHtml += `</div>`;

    entry.innerHTML = diffHtml;

    const toggle = entry.querySelector(".tl-diff-toggle")!;
    const body = entry.querySelector(".tl-diff-body")!;
    toggle.addEventListener("click", () => {
      const collapsed = body.classList.toggle("collapsed");
      toggle.textContent = collapsed ? `\u25B6 ${lineCount} lines` : `\u25BC ${lineCount} lines`;
    });

    this.timeline.appendChild(entry);
    this.timeline.scrollTop = this.timeline.scrollHeight;

    // Send the diff to Live Canvas for visual focus
    let canvasHtml = `<h4>File Modified: ${escapeHtml(filePath)}</h4>`;
    canvasHtml += `<div class="canvas-diff">`;
    if (oldStr) {
      for (const line of oldStr.split("\n")) {
        canvasHtml += `<div class="diff-removed">- ${escapeHtml(line)}</div>`;
      }
    }
    for (const line of newStr.split("\n")) {
      canvasHtml += `<div class="diff-added">+ ${escapeHtml(line)}</div>`;
    }
    canvasHtml += `</div>`;
    this.updateLiveCanvas(canvasHtml);
  }

  // ── Clear ───────────────────────────────────────────────────

  clearTimeline(): void {
    this.timeline.innerHTML = "";
  }
}

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function toolIcon(tool: string): string {
  const icons: Record<string, string> = {
    Read: "\u{1F4D6}",
    Edit: "\u270F\uFE0F",
    Write: "\u{1F4C4}",
    Bash: "\u{1F4BB}",
    Glob: "\u{1F50D}",
    Grep: "\u{1F50D}",
    LS: "\u{1F4C1}",
  };
  return icons[tool] || "\u2699\uFE0F";
}

/** Quick check if text contains markdown syntax worth rendering. */
function looksLikeMarkdown(text: string): boolean {
  return /[#*`\-\[\]|]/.test(text) && text.length > 30;
}
