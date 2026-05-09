import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Download,
  FileArchive,
  History,
  Image,
  Loader2,
  Mail,
  NotebookTabs,
  Play,
  Search,
  MessageSquare,
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const AUDIENCE_OPTIONS = [
  "technical readers",
  "engineers",
  "founders",
  "product teams",
  "students",
  "general readers",
];

const TONE_OPTIONS = [
  "clear and practical",
  "analytical and precise",
  "friendly and approachable",
  "concise and direct",
  "authoritative and technical",
  "conversational and energetic",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function extractTitle(markdown, fallback = "blog") {
  const line = (markdown || "").split("\n").find((item) => item.startsWith("# "));
  return line ? line.slice(2).trim() || fallback : fallback;
}

function safeSlug(title) {
  return (title || "blog")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 _-]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "") || "blog";
}

function normalizeImageSrc(src, outputSlug) {
  if (!src || src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }
  if (outputSlug && !src.startsWith("outputs/")) {
    return `${API_BASE}/outputs/${outputSlug}/${src.replace(/^\.\//, "")}`;
  }
  return src;
}

async function apiJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function readSse(response, onEvent) {
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const lines = rawEvent.split("\n");
      const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
      const dataText = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!dataText) continue;
      onEvent(eventName, JSON.parse(dataText));
    }
  }
}

function downloadText(filename, text, mime = "text/markdown") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadBundle(markdown, filename, outputSlug) {
  const response = await fetch(`${API_BASE}/api/bundle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, filename, output_slug: outputSlug }),
  });
  if (!response.ok) {
    throw new Error("Could not create bundle");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/\.md$/, "")}_bundle.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadExport(kind, markdown, filename, outputSlug, title) {
  const response = await fetch(`${API_BASE}/api/export/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, filename, output_slug: outputSlug, title }),
  });
  if (!response.ok) {
    throw new Error(`Could not export ${kind.toUpperCase()}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/\.md$/, "")}.${kind}`;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveBlog(outputSlug, markdown, title) {
  const response = await fetch(`${API_BASE}/api/blogs/${encodeURIComponent(outputSlug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, title }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Could not save blog");
  }
  return response.json();
}

function App() {
  const [topic, setTopic] = useState("");
  const [asOf, setAsOf] = useState(todayIso());
  const [audience, setAudience] = useState("technical readers");
  const [tone, setTone] = useState("clear and practical");
  const [blogLength, setBlogLength] = useState("medium");
  const [generateImages, setGenerateImages] = useState(true);
  const [maxImages, setMaxImages] = useState(3);
  const [result, setResult] = useState(null);
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [activeTab, setActiveTab] = useState("preview");
  const [pastBlogs, setPastBlogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState([]);
  const [regenSectionId, setRegenSectionId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);

  useEffect(() => {
    setMarkdownDraft(result?.final || "");
  }, [result?.final]);

  const finalMarkdown = markdownDraft || result?.final || "";
  const audienceOptions = useMemo(() => {
    return AUDIENCE_OPTIONS.includes(audience) ? AUDIENCE_OPTIONS : [audience, ...AUDIENCE_OPTIONS];
  }, [audience]);
  const toneOptions = useMemo(() => {
    return TONE_OPTIONS.includes(tone) ? TONE_OPTIONS : [tone, ...TONE_OPTIONS];
  }, [tone]);
  const markdownFilename = useMemo(() => {
    const title = extractTitle(finalMarkdown, result?.title || "blog");
    return `${safeSlug(title)}.md`;
  }, [finalMarkdown, result?.title]);

  useEffect(() => {
    refreshBlogs();
  }, []);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!event.target.closest?.(".export-menu") && !event.target.closest?.(".share-menu")) {
        setExportMenuOpen(false);
        setShareMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  async function refreshBlogs() {
    try {
      const blogs = await apiJson("/api/blogs");
      setPastBlogs(blogs);
    } catch {
      setPastBlogs([]);
    }
  }

  async function generateBlog() {
    if (!topic.trim()) {
      setError("Please enter a topic.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setProgress([]);
    setLogs((items) => [`Starting graph for "${topic.trim()}"`, ...items]);
    try {
      const response = await fetch(`${API_BASE}/api/generate/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          as_of: asOf,
          audience,
          tone,
          blog_length: blogLength,
          generate_images: generateImages,
          max_images: maxImages,
        }),
      });

      await readSse(response, (eventName, data) => {
        if (eventName === "progress") {
          setProgress((items) => {
            const next = [...items, data];
            return next.slice(-12);
          });
          setLogs((items) => [data.message, ...items].slice(0, 80));
          if (data.state) {
            setResult((current) => ({ ...(current || {}), ...data.state }));
            if (typeof data.state.final === "string") {
              setMarkdownDraft(data.state.final);
            }
          }
        }

        if (eventName === "complete") {
          setResult(data.result);
          setMarkdownDraft(data.result?.final || "");
          setProgress((items) => [...items, data].slice(-12));
          setLogs((items) => ["Generation complete", ...items].slice(0, 80));
        }

        if (eventName === "error") {
          throw new Error(data.message || "Generation failed");
        }
      });

      setActiveTab("preview");
      refreshBlogs();
    } catch (err) {
      setError(err.message || "Generation failed");
      setLogs((items) => [`Generation failed: ${err.message}`, ...items]);
    } finally {
      setLoading(false);
    }
  }

  async function loadBlog(filename) {
    setLoading(true);
    setError("");
    try {
      const data = await apiJson(`/api/blogs/${encodeURIComponent(filename)}`);
      setResult(data);
      setMarkdownDraft(data.final || "");
      setTopic(data.topic || data.title || "");
      if (data.as_of) {
        setAsOf(data.as_of);
      }
      if (data.audience) {
        setAudience(data.audience);
      }
      if (data.tone) {
        setTone(data.tone);
      }
      if (data.blog_length) {
        setBlogLength(data.blog_length);
      }
      if (typeof data.generate_images === "boolean") {
        setGenerateImages(data.generate_images);
      }
      if (typeof data.max_images === "number") {
        setMaxImages(data.max_images);
      }
      setActiveTab("preview");
      setLogs((items) => [`Loaded ${filename}`, ...items]);
    } catch (err) {
      setError(err.message || "Could not load blog");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateSection(sectionId) {
    if (!result?.plan || !result?.sections?.length || !result?.output_slug || !finalMarkdown) {
      setError("This blog does not have enough saved state to regenerate a section.");
      return;
    }

    setRegenSectionId(sectionId);
    setError("");
    setLogs((items) => [`Regenerating section ${sectionId}...`, ...items].slice(0, 80));

    try {
      const response = await apiJson(`/api/blogs/${encodeURIComponent(result.output_slug)}/sections/${sectionId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output_slug: result.output_slug,
          section_id: sectionId,
          topic: result.topic || topic,
          as_of: result.as_of || asOf,
          audience: result.audience || audience,
          tone: result.tone || tone,
          blog_length: result.blog_length || blogLength,
          generate_images: result.generate_images ?? generateImages,
          max_images: result.max_images ?? maxImages,
          mode: result.mode || "closed_book",
          recency_days: result.recency_days || 3650,
          plan: result.plan,
          evidence: result.evidence || [],
          sections: result.sections || [],
          final: result.final || "",
        }),
      });

      setResult((current) => ({
        ...(current || {}),
        ...response,
        output_slug: response.output_slug || result.output_slug,
      }));
      setMarkdownDraft(response.final || "");
      setActiveTab("preview");
      setLogs((items) => [`Section ${sectionId} regenerated`, ...items].slice(0, 80));
      refreshBlogs();
    } catch (err) {
      setError(err.message || "Could not regenerate section");
      setLogs((items) => [`Section ${sectionId} regeneration failed: ${err.message}`, ...items].slice(0, 80));
    } finally {
      setRegenSectionId(null);
    }
  }

  async function saveEditedBlog() {
    if (!result?.output_slug || !finalMarkdown) {
      setError("Nothing to save yet.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await saveBlog(result.output_slug, finalMarkdown, extractTitle(finalMarkdown, result?.title || "blog"));
      setResult((current) => ({
        ...(current || {}),
        ...saved,
      }));
      setMarkdownDraft(saved.final || finalMarkdown);
      setLogs((items) => [`Saved ${result.output_slug}`, ...items].slice(0, 80));
      refreshBlogs();
    } catch (err) {
      setError(err.message || "Could not save blog");
      setLogs((items) => [`Save failed: ${err.message}`, ...items].slice(0, 80));
    } finally {
      setSaving(false);
    }
  }

  async function runShare(kind) {
    if (!finalMarkdown) {
      return;
    }
    setShareMenuOpen(false);
    try {
      const path = kind === "gmail" ? "/api/share/gmail" : "/api/share/slack";
      await apiJson(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: finalMarkdown,
          title: extractTitle(finalMarkdown, result?.title || "blog"),
          output_slug: outputSlug || result?.output_slug || "",
        }),
      });
      setLogs((items) => [`Shared via ${kind.toUpperCase()}`, ...items].slice(0, 80));
    } catch (err) {
      setError(err.message || `Could not share via ${kind}`);
      setLogs((items) => [`Share failed: ${err.message}`, ...items].slice(0, 80));
    }
  }

  async function runExport(kind) {
    if (!finalMarkdown) {
      return;
    }
    setExportMenuOpen(false);
    if (kind === "md") {
      downloadText(markdownFilename, finalMarkdown);
      return;
    }
    if (kind === "bundle") {
      await downloadBundle(finalMarkdown, markdownFilename, outputSlug);
      return;
    }
    await downloadExport(kind, finalMarkdown, markdownFilename, outputSlug, result?.title || "");
  }

  const plan = result?.plan;
  const tasks = plan?.tasks || [];
  const evidence = result?.evidence || [];
  const imageSpecs = result?.image_specs || [];
  const outputSlug = result?.output_slug || "";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BookOpen size={28} />
          <div>
            <h1>Agentic Blog</h1>
          </div>
        </div>

        <section className="control-group">
          <label htmlFor="topic">Topic</label>
          <textarea
            id="topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Write about self-attention in 2026..."
            rows={7}
          />
        </section>

        <section className="control-group">
          <label htmlFor="as-of">
            <Calendar size={16} />
            As-of date
          </label>
          <input id="as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
        </section>

        <section className="control-group">
          <label htmlFor="audience">Audience</label>
          <select id="audience" value={audience} onChange={(event) => setAudience(event.target.value)}>
            {audienceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </section>

        <section className="control-group">
          <label htmlFor="tone">Tone</label>
          <select id="tone" value={tone} onChange={(event) => setTone(event.target.value)}>
            {toneOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </section>

        <section className="control-group">
          <label htmlFor="blog-length">Blog length</label>
          <select id="blog-length" value={blogLength} onChange={(event) => setBlogLength(event.target.value)}>
            <option value="short">Short</option>
            <option value="medium">Medium</option>
            <option value="long">Long</option>
          </select>
        </section>

        <section className="control-group">
          <div className="toggle-row">
            <label htmlFor="generate-images">Generate images</label>
            <label className="switch" title="Toggle image generation">
              <input
                id="generate-images"
                type="checkbox"
                checked={generateImages}
                onChange={(event) => setGenerateImages(event.target.checked)}
              />
              <span />
            </label>
          </div>
        </section>

        <section className="control-group">
          <label htmlFor="max-images">Max images: {maxImages}</label>
          <input
            id="max-images"
            type="range"
            min="0"
            max="3"
            step="1"
            value={maxImages}
            onChange={(event) => setMaxImages(Number(event.target.value))}
          />
        </section>

        <button className="primary-button" onClick={generateBlog} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          Generate Blog
        </button>

        {error && <div className="error-box">{error}</div>}

        <section className="history">
          <div className="section-title">
            <History size={17} />
            Past Blogs
          </div>
          <div className="history-list">
            {pastBlogs.length === 0 ? (
              <p className="muted">No saved blogs found.</p>
            ) : (
              pastBlogs.map((blog) => (
                <button key={blog.filename} onClick={() => loadBlog(blog.filename)}>
                  <span>{blog.title}</span>
                  <small>{blog.filename}</small>
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>{loading ? "Crafting a sharp technical story..." : "Turn ideas into publication-ready technical blogs."}</h2>
          </div>
          <div className="actions">
            <div className={`export-menu ${exportMenuOpen ? "open" : ""}`}>
              <button
                className="export-menu-toggle"
                disabled={!finalMarkdown}
                onClick={() => setExportMenuOpen((value) => !value)}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
              >
                <Download size={17} />
                Download
              </button>
              {exportMenuOpen && (
                <div className="export-menu-panel" role="menu">
                  <button type="button" role="menuitem" onClick={() => runExport("md")}>
                    Markdown
                  </button>
                  <button type="button" role="menuitem" onClick={() => runExport("html")}>
                    HTML
                  </button>
                  <button type="button" role="menuitem" onClick={() => runExport("docx")}>
                    DOCX
                  </button>
                  <button type="button" role="menuitem" onClick={() => runExport("pdf")}>
                    PDF
                  </button>
                  <button type="button" role="menuitem" onClick={() => runExport("bundle")}>
                    Zip
                  </button>
                </div>
              )}
            </div>
            <div className={`share-menu ${shareMenuOpen ? "open" : ""}`}>
              <button
                className="export-menu-toggle"
                disabled={!finalMarkdown}
                onClick={() => setShareMenuOpen((value) => !value)}
                aria-expanded={shareMenuOpen}
                aria-haspopup="menu"
              >
                <Mail size={17} />
                Share
              </button>
              {shareMenuOpen && (
                <div className="export-menu-panel" role="menu">
                  <button type="button" role="menuitem" onClick={() => runShare("gmail")}>
                    <Mail size={16} />
                    Gmail
                  </button>
                  <button type="button" role="menuitem" onClick={() => runShare("slack")}>
                    <MessageSquare size={16} />
                    Slack
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <nav className="tabs">
          <button className={activeTab === "plan" ? "active" : ""} onClick={() => setActiveTab("plan")}>
            <NotebookTabs size={16} />
            Plan
          </button>
          <button className={activeTab === "evidence" ? "active" : ""} onClick={() => setActiveTab("evidence")}>
            <Search size={16} />
            Evidence
          </button>
          <button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>
            <BookOpen size={16} />
            Preview
          </button>
          <button className={activeTab === "images" ? "active" : ""} onClick={() => setActiveTab("images")}>
            <Image size={16} />
            Images
          </button>
          <button className={activeTab === "logs" ? "active" : ""} onClick={() => setActiveTab("logs")}>
            Logs
          </button>
        </nav>

        <section className="content-panel">
          {loading && (
            <ProgressPanel progress={progress} />
          )}

          {!loading && activeTab === "preview" && (
            finalMarkdown ? (
              <div className="split-view">
                <section className="editor-pane">
                  <div className="pane-label">Markdown</div>
                  <textarea
                    className="markdown-editor"
                    value={finalMarkdown}
                    onChange={(event) => {
                      const value = event.target.value;
                      setMarkdownDraft(value);
                      setResult((current) => ({
                        ...(current || {}),
                        final: value,
                      }));
                    }}
                    spellCheck={false}
                  />
                </section>
                <article className="preview-pane markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      img: ({ src = "", alt = "" }) => (
                        <img src={normalizeImageSrc(src, outputSlug)} alt={alt} />
                      ),
                      pre: ({ children }) => <pre className="md-pre">{children}</pre>,
                      code: ({ inline, className, children }) =>
                        inline ? (
                          <code className="md-inline-code">{children}</code>
                        ) : (
                          <code className={`md-code ${className || ""}`}>{children}</code>
                        ),
                    }}
                  >
                    {finalMarkdown}
                  </ReactMarkdown>
                </article>
              </div>
            ) : (
              <EmptyState text="Enter a topic and generate a blog." />
            )
          )}

          {!loading && activeTab === "plan" && (
            plan ? (
              <div className="stack">
                <div className="summary-grid">
                  <Info label="Title" value={plan.blog_title} />
                  <Info label="Audience" value={plan.audience} />
                  <Info label="Tone" value={plan.tone} />
                  <Info label="Kind" value={plan.blog_kind} />
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Section</th>
                      <th>Words</th>
                      <th>Research</th>
                      <th>Citations</th>
                      <th>Code</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
                      <tr key={task.id}>
                        <td>{task.id}</td>
                        <td>{task.title}</td>
                        <td>{task.target_words}</td>
                        <td>{String(task.requires_research)}</td>
                        <td>{String(task.requires_citations)}</td>
                        <td>{String(task.requires_code)}</td>
                        <td>
                          <button
                            className="inline-button"
                            onClick={() => regenerateSection(task.id)}
                            disabled={!!regenSectionId || !result?.sections?.length}
                          >
                            {regenSectionId === task.id ? "Regenerating..." : "Regenerate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="No plan found for this blog." />
            )
          )}

          {!loading && activeTab === "evidence" && (
            evidence.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Published</th>
                    <th>Source</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((item, index) => (
                    <tr key={`${item.url}-${index}`}>
                      <td>{item.title}</td>
                      <td>{item.published_at || "unknown"}</td>
                      <td>{item.source || ""}</td>
                      <td>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.url}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState text="No evidence returned." />
            )
          )}

          {!loading && activeTab === "images" && (
            imageSpecs.length ? (
              <div className="image-grid">
                {imageSpecs.map((spec) => (
                  <figure key={spec.placeholder}>
                    <img
                      src={
                        outputSlug
                          ? `${API_BASE}/outputs/${outputSlug}/images/${spec.filename}`
                          : `images/${spec.filename}`
                      }
                      alt={spec.alt}
                    />
                    <figcaption>{spec.caption}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <EmptyState text="No image plan for this blog." />
            )
          )}

          {!loading && activeTab === "logs" && (
            <div className="logs">
              {logs.length ? logs.map((item, index) => <p key={`${item}-${index}`}>{item}</p>) : <p>No logs yet.</p>}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Info({ label, value }) {
  return (
    <div className="info">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

function ProgressPanel({ progress }) {
  const latest = progress[progress.length - 1];
  return (
    <div className="progress-panel">
      <div className="progress-heading">
        <Loader2 className="spin" size={24} />
        <div>
          <strong>{latest?.message || "Starting graph"}</strong>
          <span>Router, research, planning, workers, reducer, and images stream in as they finish.</span>
        </div>
      </div>

      <div className="progress-grid">
        <ProgressMetric label="Mode" value={latest?.mode || "-"} />
        <ProgressMetric label="Evidence" value={latest?.evidence_count ?? 0} />
        <ProgressMetric label="Tasks" value={latest?.tasks_count ?? 0} />
        <ProgressMetric label="Sections" value={latest?.sections_done ?? 0} />
        <ProgressMetric label="Images" value={latest?.images_count ?? 0} />
      </div>

      <div className="progress-list">
        {progress.length ? (
          progress.map((item, index) => (
            <div key={`${item.message}-${index}`} className={item.status === "complete" ? "complete" : ""}>
              {item.status === "complete" ? <CheckCircle2 size={17} /> : <Loader2 className="spin" size={17} />}
              <span>{item.message}</span>
            </div>
          ))
        ) : (
          <div>
            <Loader2 className="spin" size={17} />
            <span>Starting graph</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressMetric({ label, value }) {
  return (
    <div className="progress-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
