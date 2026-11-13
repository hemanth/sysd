import React, { useState } from 'react';
import { CHALLENGES } from '../data/challenges';
import { IconArrowRight, IconMoon, IconSun } from './Icons';

export interface LandingPageProps {
  onStartPractice: (challengeId?: string, customTopic?: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const SCHEMATIC_NODES = [
  { id: 'client', label: 'CLIENT', meta: 'HTTPS / WSS ingress · p99 < 180ms' },
  { id: 'gateway', label: 'GATEWAY', meta: 'Auth · token-bucket rate limit · TLS' },
  { id: 'service', label: 'SERVICE', meta: 'Stateless horizontally scaled compute' },
  { id: 'cache', label: 'CACHE', meta: 'Sharded Redis · sub-2ms hot reads' },
  { id: 'db', label: 'PRIMARY DB', meta: 'Durable CP state · partitioned ledger' },
  { id: 'queue', label: 'LOG / QUEUE', meta: 'Async fan-out · backpressure buffer' },
] as const;

export const SysdLogoMark: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2.5" y="9" width="5.5" height="6" rx="1" />
    <polygon points="12 7.5 15.5 12 12 16.5 8.5 12" />
    <rect x="16.5" y="4" width="5" height="5.5" rx="1" />
    <rect x="16.5" y="14.5" width="5" height="5.5" rx="1" />
    <line x1="8" y1="12" x2="8.5" y2="12" />
    <line x1="15.5" y1="10.5" x2="16.5" y2="7.5" />
    <line x1="15.5" y1="13.5" x2="16.5" y2="16.5" />
  </svg>
);

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartPractice,
  theme,
  onToggleTheme,
}) => {
  const [hoveredNode, setHoveredNode] = useState<string>('service');
  const [freeTopic, setFreeTopic] = useState('');
  const [showFreeInput, setShowFreeInput] = useState(false);

  const activeSpec =
    SCHEMATIC_NODES.find((n) => n.id === hoveredNode) ?? SCHEMATIC_NODES[2];

  const handleLaunchFreeFlow = (e?: React.FormEvent) => {
    e?.preventDefault();
    onStartPractice('free-flow', freeTopic.trim() || undefined);
  };

  return (
    <div className="sysd-landing">
      <div className="sysd-sheet">
        {/* Top Architectural Rule Bar */}
        <header className="sysd-nav">
          <div className="sysd-brand">
            <SysdLogoMark size={16} />
            <span className="sysd-wordmark">sysd</span>
            <span className="sysd-version">v1.0 · local</span>
          </div>

          <div className="sysd-nav-actions">
            <button
              type="button"
              id="landing-theme-toggle-btn"
              className="icon-btn"
              onClick={onToggleTheme}
              aria-label={
                theme === 'dark' ? 'Switch to light stone paper' : 'Switch to dark carbon'
              }
              title="Toggle surface"
            >
              {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
            </button>
            <button
              type="button"
              className="sysd-btn-ghost"
              onClick={() => onStartPractice('free-flow')}
            >
              Free-Flow
            </button>
            <button
              type="button"
              className="sysd-btn-ink"
              onClick={() => onStartPractice()}
              aria-label="Enter sysd studio"
            >
              <span>Open Studio</span>
              <IconArrowRight size={13} />
            </button>
          </div>
        </header>

        {/* Asymmetric Drafting Plate */}
        <section className="sysd-plate" aria-labelledby="sysd-hero-heading">
          <div className="sysd-plate-copy">
            <div className="sysd-kicker">00 / DISTRIBUTED SYSTEMS WORKBENCH</div>

            <h1 id="sysd-hero-heading" className="sysd-headline">
              Sketch the topology.
              <br />
              Defend the trade-offs.
            </h1>

            <p className="sysd-lead">
              An Excalidraw canvas paired with a live Socratic interviewer, voice
              turn-taking, and Staff-level reference architectures. Everything runs
              locally in your browser on WebAssembly and WebGPU.
            </p>

            <div className="sysd-cta-row">
              <button
                type="button"
                id="start-practice-btn"
                data-testid="start-practice-btn"
                className="sysd-btn-ink lg"
                onClick={() => onStartPractice()}
              >
                <span>Start Timed Mock</span>
                <IconArrowRight size={14} />
              </button>

              <button
                type="button"
                id="start-freeflow-btn"
                data-testid="start-freeflow-btn"
                className="sysd-btn-outline lg"
                onClick={() => {
                  if (showFreeInput) {
                    handleLaunchFreeFlow();
                  } else {
                    setShowFreeInput(true);
                  }
                }}
              >
                <span>Free-Flow Canvas</span>
              </button>
            </div>

            {showFreeInput && (
              <form className="sysd-freeflow-bar" onSubmit={handleLaunchFreeFlow}>
                <input
                  type="text"
                  className="sysd-freeflow-input"
                  placeholder="Optional topic (e.g. Stripe Webhooks, Multi-Region KV) or leave blank…"
                  value={freeTopic}
                  onChange={(e) => setFreeTopic(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="sysd-btn-ink">
                  <span>Enter</span>
                  <IconArrowRight size={12} />
                </button>
              </form>
            )}
          </div>

          {/* Interactive Vector Blueprint Schematic */}
          <div className="sysd-plate-diagram" aria-label="Interactive system topology schematic">
            <div className="sysd-diagram-bar">
              <span>FIG 01 · LIVE TOPOLOGY PARSER</span>
              <span>HOVER NODE</span>
            </div>

            <svg
              className="sysd-blueprint-svg"
              viewBox="0 0 420 228"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Wire edges */}
              <path d="M84 114 H128" className="sysd-wire" />
              <path d="M196 114 H234" className="sysd-wire" />
              <path d="M306 96 L332 52" className="sysd-wire" />
              <path d="M306 114 H332" className="sysd-wire" />
              <path d="M306 132 L332 176" className="sysd-wire" />

              {/* Animated packet traces */}
              <circle r="2.3" className="sysd-packet">
                <animateMotion dur="2.6s" repeatCount="indefinite" path="M84 114 H128" />
              </circle>
              <circle r="2.3" className="sysd-packet">
                <animateMotion dur="2.6s" begin="-0.9s" repeatCount="indefinite" path="M196 114 H234" />
              </circle>
              <circle r="2.3" className="sysd-packet">
                <animateMotion dur="2.8s" begin="-1.5s" repeatCount="indefinite" path="M306 96 L332 52" />
              </circle>
              <circle r="2.3" className="sysd-packet">
                <animateMotion dur="3.1s" begin="-2.1s" repeatCount="indefinite" path="M306 132 L332 176" />
              </circle>

              {/* CLIENT */}
              <g
                className={`sysd-svg-node ${hoveredNode === 'client' ? 'active' : ''}`}
                onMouseEnter={() => setHoveredNode('client')}
                onClick={() => onStartPractice()}
              >
                <rect x="18" y="94" width="66" height="40" rx="3" />
                <text x="51" y="118" textAnchor="middle">CLIENT</text>
              </g>

              {/* GATEWAY (diamond) */}
              <g
                className={`sysd-svg-node ${hoveredNode === 'gateway' ? 'active' : ''}`}
                onMouseEnter={() => setHoveredNode('gateway')}
                onClick={() => onStartPractice()}
              >
                <polygon points="162,84 196,114 162,144 128,114" />
                <text x="162" y="118" textAnchor="middle">GW / LB</text>
              </g>

              {/* SERVICE */}
              <g
                className={`sysd-svg-node ${hoveredNode === 'service' ? 'active' : ''}`}
                onMouseEnter={() => setHoveredNode('service')}
                onClick={() => onStartPractice()}
              >
                <rect x="234" y="92" width="72" height="44" rx="3" />
                <text x="270" y="118" textAnchor="middle">SERVICE</text>
              </g>

              {/* CACHE */}
              <g
                className={`sysd-svg-node ${hoveredNode === 'cache' ? 'active' : ''}`}
                onMouseEnter={() => setHoveredNode('cache')}
                onClick={() => onStartPractice()}
              >
                <rect x="332" y="30" width="72" height="38" rx="3" />
                <text x="368" y="53" textAnchor="middle">REDIS</text>
              </g>

              {/* PRIMARY DB */}
              <g
                className={`sysd-svg-node ${hoveredNode === 'db' ? 'active' : ''}`}
                onMouseEnter={() => setHoveredNode('db')}
                onClick={() => onStartPractice()}
              >
                <rect x="332" y="95" width="72" height="38" rx="3" />
                <text x="368" y="118" textAnchor="middle">STORAGE</text>
              </g>

              {/* QUEUE */}
              <g
                className={`sysd-svg-node ${hoveredNode === 'queue' ? 'active' : ''}`}
                onMouseEnter={() => setHoveredNode('queue')}
                onClick={() => onStartPractice()}
              >
                <rect x="332" y="160" width="72" height="38" rx="3" />
                <text x="368" y="183" textAnchor="middle">STREAM</text>
              </g>
            </svg>

            <div className="sysd-diagram-readout">
              <span className="sysd-readout-key">{activeSpec.label}</span>
              <span className="sysd-readout-val">{activeSpec.meta}</span>
            </div>
          </div>
        </section>

        {/* Swiss Numbered Archetype Ledger */}
        <section id="challenges" className="sysd-ledger" aria-labelledby="sysd-ledger-heading">
          <div className="sysd-ledger-head">
            <span id="sysd-ledger-heading">01 — 11 / CANONICAL ARCHETYPES + REFERENCE SOLUTIONS</span>
            <span className="hide-mobile">SELECT TO OPEN DIRECTLY ON CANVAS</span>
          </div>

          <button
            type="button"
            className="sysd-ledger-row freeflow-row"
            onClick={() => onStartPractice('free-flow')}
          >
            <span className="sysd-row-idx">00</span>
            <span className="sysd-row-title">Free-Flow Architecture Canvas</span>
            <span className="sysd-row-sub hide-mobile">
              Unscripted whiteboard with live graph diagnostics, voice Q&amp;A &amp; custom prompts
            </span>
            <span className="sysd-row-tag">OPEN · ANY</span>
            <IconArrowRight size={13} className="sysd-row-arrow" />
          </button>

          {CHALLENGES.map((ch, idx) => (
            <button
              key={ch.id}
              type="button"
              className="sysd-ledger-row"
              onClick={() => onStartPractice(ch.id)}
              aria-label={`Practice ${ch.title}`}
            >
              <span className="sysd-row-idx">{String(idx + 1).padStart(2, '0')}</span>
              <span className="sysd-row-title">{ch.title}</span>
              <span className="sysd-row-sub hide-mobile">{ch.subtitle}</span>
              <span className="sysd-row-tag">
                {ch.category === 'product' ? 'PRODUCT' : 'INFRA'} · {ch.difficulty.toUpperCase()}
              </span>
              <IconArrowRight size={13} className="sysd-row-arrow" />
            </button>
          ))}
        </section>

        {/* Quiet Tactile Studio Footer */}
        <footer className="sysd-footer">
          <span>sysd · wasm + webgpu local workbench · 11 reference blueprints</span>
          <span className="sysd-credit">
            Made with{' '}
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              style={{ verticalAlign: '-1px' }}
            >
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>{' '}
            <a href="https://h3manth.com" target="_blank" rel="noopener noreferrer">
              Hemanth HM
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
};
