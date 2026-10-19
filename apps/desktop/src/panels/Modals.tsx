import { ANIMA_VERSION } from "@raveanima/core";
import { exportAs, isDesktop, type ExportKind } from "../platform";
import { getUi, setUi, useStore } from "../store";

const OPTIONS: { kind: ExportKind; title: string; sub: string; ext: string; desktop?: boolean }[] = [
  { kind: "lottie", title: "Lottie", sub: "Plays in lottie-web, iOS, Android, Flutter, Skottie", ext: ".json" },
  { kind: "html", title: "Interactive web page", sub: "One file with the player: state machines, hover and clicks", ext: ".html" },
  { kind: "mp4", title: "Video", sub: "H.264, ready for social and decks", ext: ".mp4", desktop: true },
  { kind: "gif", title: "GIF", sub: "Loops everywhere, chats and docs", ext: ".gif", desktop: true },
  { kind: "webm", title: "WebM with alpha", sub: "Transparent video for the web", ext: ".webm", desktop: true },
  { kind: "svg", title: "SVG", sub: "Vector of the current frame", ext: ".svg" },
  { kind: "png", title: "PNG", sub: "Current frame at 2x", ext: ".png" },
];

export function Modals() {
  useStore();
  const ui = getUi();
  if (ui.exportOpen)
    return (
      <div className="scrim" onPointerDown={() => setUi({ exportOpen: false })}>
        <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
          <h2>Export</h2>
          <p>The active animation renders with the same engine you see on the canvas.</p>
          {OPTIONS.filter((o) => isDesktop || !o.desktop).map((o) => (
            <button
              key={o.kind}
              className="opt"
              onClick={() => {
                setUi({ exportOpen: false });
                exportAs(o.kind);
              }}
            >
              <span>
                <b>{o.title}</b>
                <small>{o.sub}</small>
              </span>
              <span className="ext">{o.ext}</span>
            </button>
          ))}
        </div>
      </div>
    );
  if (ui.aboutOpen)
    return (
      <div className="scrim" onPointerDown={() => setUi({ aboutOpen: false })}>
        <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
          <h2>
            RaveAnima<span style={{ color: "var(--accent)" }}>.</span>
          </h2>
          <p>
            Version {ANIMA_VERSION}. MIT License. 2D vector design and animation for people and AI agents. Every tool in this window is a command that agents can run too.
          </p>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Connect an agent (Claude Code, Cursor, any MCP client)</div>
          <pre>{`claude mcp add raveanima -- raveanima mcp --live`}</pre>
          <div style={{ color: "var(--muted)", marginBottom: 6 }}>Headless, no window needed:</div>
          <pre>{`claude mcp add raveanima-headless -- raveanima mcp`}</pre>
          <p style={{ marginTop: 16, marginBottom: 0 }}>
            Developed by Dias Zhumagaliyev:{" "}
            <a href="https://dias.now" target="_blank" rel="noreferrer" style={{ color: "var(--ink)" }}>
              https://dias.now
            </a>
            {" "}· hello@dias.now
          </p>
          <div className="foot">
            <button className="pill ink" onClick={() => setUi({ aboutOpen: false })}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  return null;
}
