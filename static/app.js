/* ============================================================
   THE EXPEDITION — Math Companion SPA
   Vanilla JS, no framework, no build step
   ============================================================ */

'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────────

const state = {
  curriculum: null,
  progress: {},
  stats: {},
  currentView: null,       // 'dashboard' | 'expedition' | 'unit' | 'section'
  currentExpId: null,
  currentUnitId: null,
  currentSectionId: null,
  sessionStart: null,      // track time in current section
  sessionSectionId: null,
};

// ── API ───────────────────────────────────────────────────────────────────────

const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
    return r.json();
  },
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatMinutes(min) {
  if (!min) return '';
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min} min`;
}

function el(tag, cls, inner) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (inner !== undefined) e.innerHTML = inner;
  return e;
}

function mount(html) {
  const root = document.getElementById('view-root');
  root.innerHTML = html;
  root.className = 'view';
  root.scrollTop = 0;
  window.scrollTo(0, 0);
}

function renderContent(raw) {
  if (!raw) return '';
  // Escape HTML
  let text = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Inline code: `...`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Split into paragraphs on double newlines or single newlines
  const paragraphs = text.split(/\n\n+/);
  return paragraphs
    .map(p => {
      const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return '';
      // Detect step lines (Step N:)
      if (lines.every(l => l.match(/^(Step \d+:|Check:|Example:)/i) || lines.length === 1)) {
        return '<p>' + lines.join('<br>') + '</p>';
      }
      return '<p>' + lines.join('<br>') + '</p>';
    })
    .filter(Boolean)
    .join('');
}

function getSectionIcon(type) {
  const icons = {
    lesson: '📖',
    scenario: '🔬',
    rabbit_hole: '🐇',
    practice: '✏️',
    quiz: '🎯',
  };
  return icons[type] || '📄';
}

function getStatusBadge(status) {
  if (status === 'completed') return '<span class="badge badge-complete">✅ Complete</span>';
  if (status === 'in_progress') return '<span class="badge badge-progress">→ In Progress</span>';
  return '<span class="badge badge-not-started">🧭 Not Started</span>';
}

function findExp(expId) {
  return state.curriculum.expeditions.find(e => e.id === expId);
}

function findUnit(expId, unitId) {
  const exp = findExp(expId);
  return exp?.units.find(u => u.id === unitId);
}

function findSection(expId, unitId, sectionId) {
  const unit = findUnit(expId, unitId);
  return unit?.sections?.find(s => s.id === sectionId);
}

function getUnitProgress(unit) {
  const sections = unit.sections || [];
  if (!sections.length) return { pct: 0, done: 0, total: 0 };
  const done = sections.filter(s => state.progress[s.id]?.status === 'completed').length;
  return { pct: Math.round((done / sections.length) * 100), done, total: sections.length };
}

function getExpProgress(exp) {
  let done = 0, total = 0;
  for (const u of exp.units || []) {
    const { done: d, total: t } = getUnitProgress(u);
    done += d; total += t;
  }
  return { pct: total ? Math.round((done / total) * 100) : 0, done, total };
}

function findContinueTarget() {
  for (const exp of state.curriculum.expeditions) {
    if (exp.locked) continue;
    for (const unit of exp.units || []) {
      for (const section of unit.sections || []) {
        const st = state.progress[section.id]?.status;
        if (!st || st === 'not_started' || st === 'in_progress') {
          return { expId: exp.id, unitId: unit.id, sectionId: section.id };
        }
      }
    }
  }
  return null;
}

// ── TIME TRACKING ─────────────────────────────────────────────────────────────

function startSession(sectionId) {
  endSession(); // flush any previous
  state.sessionStart = Date.now();
  state.sessionSectionId = sectionId;
}

async function endSession() {
  if (!state.sessionStart || !state.sessionSectionId) return;
  const seconds = Math.round((Date.now() - state.sessionStart) / 1000);
  const sectionId = state.sessionSectionId;
  state.sessionStart = null;
  state.sessionSectionId = null;
  if (seconds > 5) {
    try { await api.post('/api/time', { section_id: sectionId, seconds }); } catch {}
  }
}

window.addEventListener('beforeunload', () => {
  if (state.sessionStart && state.sessionSectionId) {
    const seconds = Math.round((Date.now() - state.sessionStart) / 1000);
    if (seconds > 5) {
      navigator.sendBeacon('/api/time', JSON.stringify({
        section_id: state.sessionSectionId, seconds,
      }));
    }
  }
});

// ── NAVIGATION ────────────────────────────────────────────────────────────────

function navigate(view, params = {}) {
  endSession();
  state.currentView = view;
  state.currentExpId = params.expId || null;
  state.currentUnitId = params.unitId || null;
  state.currentSectionId = params.sectionId || null;

  const render = {
    dashboard: renderDashboard,
    expedition: renderExpeditionDetail,
    unit: renderUnitDetail,
    section: renderSection,
  };
  (render[view] || renderDashboard)();
}

// ── INIT ──────────────────────────────────────────────────────────────────────

async function init() {
  document.getElementById('nav-home-btn').addEventListener('click', () => navigate('dashboard'));
  try {
    [state.curriculum, state.progress, state.stats] = await Promise.all([
      api.get('/api/curriculum'),
      api.get('/api/progress'),
      api.get('/api/stats'),
    ]);
    navigate('dashboard');
  } catch (err) {
    document.getElementById('view-root').innerHTML =
      `<div class="loading">⚠️ Could not connect to server. Make sure the app is running.<br><small>${err.message}</small></div>`;
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

function renderDashboard() {
  const s = state.stats;
  const continueTarget = findContinueTarget();
  const totalSections = s.total_sections || 0;
  const completedSections = s.completed_sections || 0;

  let html = `
    <div class="dashboard-hero">
      <div class="hero-icon">🧭</div>
      <h1>The Expedition</h1>
      <p class="subtitle">A year-long journey through the mathematics of data science. Take it one unit at a time.</p>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${formatTime(s.total_time_seconds || 0)}</div>
        <div class="stat-label">Time Studied</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatTime(s.estimated_remaining_seconds || 0)}</div>
        <div class="stat-label">Estimated Remaining</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${completedSections}<span style="font-size:1rem;color:var(--color-text-muted)">/${totalSections}</span></div>
        <div class="stat-label">Sections Complete</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${s.streak_days || 0}</div>
        <div class="stat-label">Day Streak 🔥</div>
      </div>
    </div>
  `;

  if (continueTarget) {
    html += `<button class="continue-btn" id="continue-btn">Continue Journey →</button>`;
  }

  html += `<div class="section-title">Your Expeditions</div><div class="expedition-grid" id="exp-grid"></div>`;

  mount(html);

  if (continueTarget) {
    document.getElementById('continue-btn').addEventListener('click', () => {
      navigate('section', continueTarget);
    });
  }

  const grid = document.getElementById('exp-grid');
  for (const exp of state.curriculum.expeditions) {
    const { pct, done, total } = getExpProgress(exp);
    const unitCount = exp.units?.length || 0;
    const card = document.createElement('div');
    card.className = `expedition-card ${exp.locked ? 'locked' : ''}`;
    card.innerHTML = `
      <div class="exp-header">
        <div>
          <div class="exp-number">Expedition ${exp.order}</div>
          <div class="exp-title">${exp.title}</div>
          <div class="exp-theme">${exp.theme || ''}</div>
        </div>
        <div class="exp-lock">${exp.locked ? '🔒' : (pct === 100 ? '✅' : '🧭')}</div>
      </div>
      <div class="exp-meta">
        <span>${unitCount} unit${unitCount !== 1 ? 's' : ''}</span>
        <div class="progress-bar-wrap" style="flex:1">
          <div class="progress-bar ${pct===100?'complete':''}" style="width:${pct}%"></div>
        </div>
        <span class="progress-label">${pct}%</span>
      </div>
      ${exp.locked ? '<span class="badge badge-locked">🔒 Complete Expedition 1 to unlock</span>' : getStatusBadge(pct === 100 ? 'completed' : pct > 0 ? 'in_progress' : 'not_started')}
    `;
    if (!exp.locked) {
      card.addEventListener('click', () => navigate('expedition', { expId: exp.id }));
    }
    grid.appendChild(card);
  }
}

// ── EXPEDITION DETAIL ─────────────────────────────────────────────────────────

function renderExpeditionDetail() {
  const exp = findExp(state.currentExpId);
  if (!exp) { navigate('dashboard'); return; }
  const { pct } = getExpProgress(exp);

  let html = `
    <div class="exp-detail-header">
      <button class="back-btn" id="back-dash">← All Expeditions</button>
      <h1>${exp.title}</h1>
      <div class="exp-theme-tag">${exp.theme || ''}</div>
    </div>
  `;

  if (exp.funFact) {
    html += `
      <div class="callout-fun-fact">
        <div class="callout-label">✨ Fun Fact</div>
        ${exp.funFact}
      </div>
    `;
  }

  if (exp.jobConnection) {
    html += `
      <div class="callout-job">
        <div class="callout-label">💼 Why This Matters For Your Work</div>
        ${exp.jobConnection}
      </div>
    `;
  }

  html += `<div class="section-title">Units</div><div class="unit-list" id="unit-list"></div>`;

  mount(html);

  document.getElementById('back-dash').addEventListener('click', () => navigate('dashboard'));

  const list = document.getElementById('unit-list');
  for (const unit of exp.units || []) {
    const { pct: upct, done, total } = getUnitProgress(unit);
    const row = document.createElement('div');
    const isComplete = upct === 100;
    row.className = `unit-row ${isComplete ? 'complete' : ''}`;
    row.innerHTML = `
      <div class="unit-order">${isComplete ? '✓' : unit.order}</div>
      <div class="unit-info">
        <div class="unit-title">${unit.title}</div>
        <div class="unit-desc">${unit.description || ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.4rem;flex-shrink:0">
        <div class="unit-time">${formatMinutes(unit.estimatedMinutes)}</div>
        ${total > 0 ? getStatusBadge(isComplete ? 'completed' : done > 0 ? 'in_progress' : 'not_started') : '<span class="badge badge-not-started">Coming Soon</span>'}
      </div>
    `;
    if (total > 0) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => navigate('unit', { expId: exp.id, unitId: unit.id }));
    }
    list.appendChild(row);
  }
}

// ── UNIT DETAIL ───────────────────────────────────────────────────────────────

function renderUnitDetail() {
  const exp = findExp(state.currentExpId);
  const unit = findUnit(state.currentExpId, state.currentUnitId);
  if (!unit) { navigate('expedition', { expId: state.currentExpId }); return; }
  const { pct, done, total } = getUnitProgress(unit);
  const sections = unit.sections || [];

  let html = `
    <div class="nav-breadcrumb">
      <span class="crumb" id="bc-dash">Base Camp</span>
      <span class="sep">›</span>
      <span class="crumb" id="bc-exp">${exp.title}</span>
      <span class="sep">›</span>
      <span class="current">${unit.title}</span>
    </div>

    <div class="unit-detail-header">
      <h1>${unit.title}</h1>
      <p class="unit-desc-text">${unit.description || ''}</p>
      <div class="unit-progress-row">
        <div class="progress-bar-wrap" style="flex:1">
          <div class="progress-bar ${pct===100?'complete':''}" style="width:${pct}%"></div>
        </div>
        <span class="progress-label">${done}/${total} sections</span>
      </div>
    </div>
  `;

  if (unit.orientation) {
    html += `
      <div class="orientation-box">
        <div class="orientation-label">🗺️ Orientation</div>
        ${unit.orientation}
      </div>
    `;
  }

  html += `<div class="section-list" id="sec-list"></div>`;

  if (unit.objectives?.length) {
    html += `
      <div class="objectives-card">
        <h3>🎯 Your Objectives</h3>
        <div id="obj-list"></div>
      </div>
    `;
  }

  mount(html);

  document.getElementById('bc-dash').addEventListener('click', () => navigate('dashboard'));
  document.getElementById('bc-exp').addEventListener('click', () => navigate('expedition', { expId: exp.id }));

  // Sections
  const list = document.getElementById('sec-list');
  sections.forEach((s, idx) => {
    const status = state.progress[s.id]?.status || 'not_started';
    const row = document.createElement('div');
    row.className = 'section-row';
    row.innerHTML = `
      <div class="section-icon">${getSectionIcon(s.type)}</div>
      <div class="section-info">
        <div class="section-title-text">${s.title}</div>
        <div class="section-time">${formatMinutes(s.estimatedMinutes)}</div>
      </div>
      ${getStatusBadge(status)}
    `;
    row.addEventListener('click', () => navigate('section', {
      expId: exp.id, unitId: unit.id, sectionId: s.id,
    }));
    list.appendChild(row);
  });

  // Objectives
  const objList = document.getElementById('obj-list');
  if (objList) {
    (unit.objectives || []).forEach((obj, i) => {
      // Mark objective done if corresponding section is complete
      const relSection = sections[i];
      const done = relSection && state.progress[relSection.id]?.status === 'completed';
      const item = document.createElement('div');
      item.className = `objective-item ${done ? 'done' : ''}`;
      item.innerHTML = `
        <span class="obj-check">${done ? '✅' : '○'}</span>
        <span>${obj}</span>
      `;
      objList.appendChild(item);
    });
  }
}

// ── SECTION ROUTER ────────────────────────────────────────────────────────────

function renderSection() {
  const section = findSection(state.currentExpId, state.currentUnitId, state.currentSectionId);
  if (!section) { navigate('unit', { expId: state.currentExpId, unitId: state.currentUnitId }); return; }

  startSession(section.id);

  const renders = {
    lesson: renderLesson,
    scenario: renderNarrativeSection,
    rabbit_hole: renderNarrativeSection,
    practice: renderPractice,
    quiz: renderQuiz,
  };
  (renders[section.type] || renderLesson)(section);
}

function breadcrumb() {
  const exp = findExp(state.currentExpId);
  const unit = findUnit(state.currentExpId, state.currentUnitId);
  return `
    <div class="nav-breadcrumb">
      <span class="crumb bc-dash">Base Camp</span>
      <span class="sep">›</span>
      <span class="crumb bc-exp">${exp?.title || ''}</span>
      <span class="sep">›</span>
      <span class="crumb bc-unit">${unit?.title || ''}</span>
    </div>
  `;
}

function attachBreadcrumbListeners() {
  document.querySelectorAll('.bc-dash').forEach(el =>
    el.addEventListener('click', () => navigate('dashboard')));
  document.querySelectorAll('.bc-exp').forEach(el =>
    el.addEventListener('click', () => navigate('expedition', { expId: state.currentExpId })));
  document.querySelectorAll('.bc-unit').forEach(el =>
    el.addEventListener('click', () => navigate('unit', { expId: state.currentExpId, unitId: state.currentUnitId })));
}

function getPrevNextSections() {
  const unit = findUnit(state.currentExpId, state.currentUnitId);
  const sections = unit?.sections || [];
  const idx = sections.findIndex(s => s.id === state.currentSectionId);
  return {
    prev: idx > 0 ? sections[idx - 1] : null,
    next: idx < sections.length - 1 ? sections[idx + 1] : null,
  };
}

function navBarHTML(section) {
  const { prev, next } = getPrevNextSections();
  const status = state.progress[section.id]?.status;
  const isDone = status === 'completed';
  return `
    <div class="lesson-nav-bar">
      <button class="btn btn-secondary" id="nav-prev" ${!prev ? 'disabled' : ''}>← Previous</button>
      <button class="btn ${isDone ? 'btn-secondary' : 'btn-success'}" id="mark-complete-btn">
        ${isDone ? '✅ Completed' : 'Mark as Complete'}
      </button>
      <button class="btn btn-primary" id="nav-next" ${!next ? 'disabled' : ''}>Next →</button>
    </div>
  `;
}

function attachNavBar(section) {
  const { prev, next } = getPrevNextSections();
  document.getElementById('nav-prev')?.addEventListener('click', () => {
    if (prev) navigate('section', { expId: state.currentExpId, unitId: state.currentUnitId, sectionId: prev.id });
  });
  document.getElementById('nav-next')?.addEventListener('click', () => {
    if (next) navigate('section', { expId: state.currentExpId, unitId: state.currentUnitId, sectionId: next.id });
  });
  const markBtn = document.getElementById('mark-complete-btn');
  if (markBtn) {
    markBtn.addEventListener('click', async () => {
      await markComplete(section.id);
      markBtn.textContent = '✅ Completed';
      markBtn.className = 'btn btn-secondary';
    });
  }
}

async function markComplete(sectionId) {
  state.progress[sectionId] = { ...state.progress[sectionId], status: 'completed' };
  try { await api.post(`/api/progress/${sectionId}`, { status: 'completed' }); } catch {}
  try { state.stats = await api.get('/api/stats'); } catch {}
}

// ── LESSON ────────────────────────────────────────────────────────────────────

function renderLesson(section) {
  const typeLabel = { lesson: 'Lesson', scenario: 'Scenario', rabbit_hole: 'Rabbit Hole' }[section.type] || 'Lesson';
  const bannerClass = `banner-${section.type}`;

  let html = `
    <div class="lesson-reader">
      ${breadcrumb()}
      <div class="section-type-banner ${bannerClass}">
        ${getSectionIcon(section.type)} ${typeLabel} · ${formatMinutes(section.estimatedMinutes)}
      </div>
      <h1>${section.title}</h1>
      <div class="lesson-content">${renderContent(section.content)}</div>
  `;

  if (section.keyInsight) {
    html += `
      <div class="callout-insight">
        <div class="callout-label">💡 Key Insight</div>
        <p>${section.keyInsight}</p>
      </div>
    `;
  }

  if (section.resource) {
    html += `
      <div class="callout-resource">
        <div>
          <div class="resource-label">📺 Recommended Resource</div>
          <a href="${section.resource.url}" target="_blank" rel="noopener">${section.resource.title}</a>
          <span style="color:var(--color-text-muted);font-size:0.8rem"> — ${section.resource.source}</span>
        </div>
      </div>
    `;
  }

  if (section.hasBalanceScale) {
    html += renderBalanceScale();
  }

  html += navBarHTML(section);
  html += `</div>`;

  mount(html);
  attachBreadcrumbListeners();
  attachNavBar(section);

  if (section.hasBalanceScale) {
    initBalanceScale();
  }

  // Auto-mark in_progress
  if (!state.progress[section.id]?.status || state.progress[section.id].status === 'not_started') {
    state.progress[section.id] = { status: 'in_progress' };
    api.post(`/api/progress/${section.id}`, { status: 'in_progress' }).catch(() => {});
  }
}

// ── NARRATIVE SECTIONS (scenario / rabbit hole) ───────────────────────────────

function renderNarrativeSection(section) {
  const isScenario = section.type === 'scenario';
  const calloutClass = isScenario ? 'callout-scenario' : 'callout-rabbit';
  const icon = isScenario ? '🔬' : '🐇';
  const label = isScenario ? 'Real-World Scenario' : 'Rabbit Hole';

  let html = `
    <div class="lesson-reader">
      ${breadcrumb()}
      <div class="section-type-banner banner-${section.type}">
        ${icon} ${label} · ${formatMinutes(section.estimatedMinutes)}
      </div>
      <h1>${section.title}</h1>
      <div class="${calloutClass}">
        <div class="callout-label">${icon} ${label}</div>
        <div class="lesson-content" style="margin-top:0.5rem">${renderContent(section.content)}</div>
      </div>
      ${navBarHTML(section)}
    </div>
  `;

  mount(html);
  attachBreadcrumbListeners();
  attachNavBar(section);

  if (!state.progress[section.id]?.status || state.progress[section.id].status === 'not_started') {
    state.progress[section.id] = { status: 'in_progress' };
    api.post(`/api/progress/${section.id}`, { status: 'in_progress' }).catch(() => {});
  }
}

// ── BALANCE SCALE ─────────────────────────────────────────────────────────────

function renderBalanceScale() {
  return `
    <div class="balance-scale-container">
      <div class="balance-scale-title">⚖️ Interactive Balance Scale — Solving 3x + 7 = 22</div>
      <div class="balance-scale-steps">
        <button class="scale-step-btn active" data-step="0">Start</button>
        <button class="scale-step-btn" data-step="1">Step 1: −7</button>
        <button class="scale-step-btn" data-step="2">Step 2: ÷3</button>
      </div>
      <svg id="balance-svg" viewBox="0 0 440 220" xmlns="http://www.w3.org/2000/svg">
        <!-- Fulcrum -->
        <polygon points="220,195 205,215 235,215" fill="#9b7b2a"/>
        <!-- Base -->
        <rect x="190" y="215" width="60" height="6" rx="3" fill="#7a6848"/>
        <!-- Beam (will be rotated by JS) -->
        <g id="scale-beam" style="transform-origin:220px 195px;transition:transform 0.6s ease">
          <rect x="60" y="190" width="320" height="5" rx="2.5" fill="#9b7b2a"/>
          <!-- Left chain -->
          <line x1="90" y1="190" x2="90" y2="155" stroke="#b8ad9e" stroke-width="2"/>
          <!-- Right chain -->
          <line x1="350" y1="190" x2="350" y2="155" stroke="#b8ad9e" stroke-width="2"/>
          <!-- Left pan -->
          <ellipse cx="90" cy="152" rx="45" ry="10" fill="#eee8db" stroke="#d6ccba" stroke-width="1.5"/>
          <!-- Right pan -->
          <ellipse cx="350" cy="152" rx="45" ry="10" fill="#eee8db" stroke="#d6ccba" stroke-width="1.5"/>
        </g>
        <!-- Left label (not rotated) -->
        <text id="left-label" x="90" y="145" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="13" fill="#2c2013">3x + 7</text>
        <!-- Right label -->
        <text id="right-label" x="350" y="145" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="13" fill="#2c2013">22</text>
        <!-- Pivot dot -->
        <circle cx="220" cy="193" r="5" fill="#9b7b2a"/>
      </svg>
      <div id="scale-equation" class="scale-equation">3x + 7 = 22</div>
      <p style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.5rem">Click steps above to walk through the solution</p>
    </div>
  `;
}

function initBalanceScale() {
  const steps = [
    { left: '3x + 7', right: '22',  eq: '3x + 7 = 22',  tilt: 0  },
    { left: '3x',     right: '15',  eq: '3x = 15  (subtracted 7 from both sides)', tilt: 0  },
    { left: 'x',      right: '5',   eq: 'x = 5  (divided both sides by 3) ✓',     tilt: 0  },
  ];

  let active = 0;

  function render(step) {
    document.getElementById('left-label').textContent = steps[step].left;
    document.getElementById('right-label').textContent = steps[step].right;
    document.getElementById('scale-equation').textContent = steps[step].eq;
    document.getElementById('scale-beam').style.transform = `rotate(${steps[step].tilt}deg)`;
    document.querySelectorAll('.scale-step-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === step);
    });
  }

  document.querySelectorAll('.scale-step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      active = parseInt(btn.dataset.step);
      render(active);
    });
  });

  render(0);
}

// ── PRACTICE ──────────────────────────────────────────────────────────────────

function renderPractice(section) {
  const problems = section.problems || [];

  let html = `
    <div class="lesson-reader">
      ${breadcrumb()}
      <div class="section-type-banner banner-practice">
        ✏️ Practice Problems · ${formatMinutes(section.estimatedMinutes)}
      </div>
      <h1>${section.title}</h1>
      <p style="color:var(--color-text-muted);margin-bottom:1.5rem;font-size:0.9rem">Work through each problem. Use "Check Answer" to verify, or "Reveal" if you're stuck.</p>
      <div class="practice-list" id="practice-list"></div>
      ${navBarHTML(section)}
    </div>
  `;

  mount(html);
  attachBreadcrumbListeners();

  const list = document.getElementById('practice-list');
  problems.forEach((prob, idx) => {
    const card = buildProblemCard(prob, idx);
    list.appendChild(card);
  });

  attachNavBar(section);

  if (!state.progress[section.id]?.status || state.progress[section.id].status === 'not_started') {
    state.progress[section.id] = { status: 'in_progress' };
    api.post(`/api/progress/${section.id}`, { status: 'in_progress' }).catch(() => {});
  }
}

function buildProblemCard(prob, idx) {
  const card = document.createElement('div');
  card.className = 'practice-problem';

  const qHTML = renderContent(prob.question);

  card.innerHTML = `
    <div class="problem-number">Problem ${idx + 1}</div>
    <div class="problem-question">${qHTML}</div>
    <input type="text" class="problem-input" placeholder="Your answer…" id="prob-input-${idx}" />
    <div class="hint-box" id="hint-${idx}">${prob.hint || ''}</div>
    <div class="problem-actions">
      <button class="btn btn-primary" id="check-${idx}">Check Answer</button>
      <button class="reveal-link" id="reveal-${idx}">Reveal Answer</button>
      ${prob.hint ? `<button class="reveal-link" id="hint-btn-${idx}">💡 Hint</button>` : ''}
    </div>
    <div class="problem-feedback" id="fb-${idx}"></div>
  `;

  card.querySelector(`#check-${idx}`).addEventListener('click', () => {
    const input = card.querySelector(`#prob-input-${idx}`).value.trim();
    showFeedback(idx, prob, input, false);
  });

  card.querySelector(`#reveal-${idx}`).addEventListener('click', () => {
    showFeedback(idx, prob, null, true);
  });

  const hintBtn = card.querySelector(`#hint-btn-${idx}`);
  if (hintBtn) {
    hintBtn.addEventListener('click', () => {
      const hintEl = card.querySelector(`#hint-${idx}`);
      hintEl.classList.toggle('show');
    });
  }

  card.querySelector(`#prob-input-${idx}`).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = card.querySelector(`#prob-input-${idx}`).value.trim();
      showFeedback(idx, prob, input, false);
    }
  });

  return card;
}

function showFeedback(idx, prob, userAnswer, revealed) {
  const fb = document.getElementById(`fb-${idx}`);
  let correct = false;
  if (!revealed && userAnswer) {
    // Simple fuzzy match
    const norm = s => s.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9.+\-*/=√]/g, '');
    correct = norm(userAnswer) === norm(prob.answer) ||
              prob.answer.toLowerCase().includes(userAnswer.toLowerCase());
  }

  if (revealed) {
    fb.className = 'problem-feedback show correct';
    fb.innerHTML = `
      <div class="fb-label">💡 Answer</div>
      <strong style="font-family:var(--font-mono)">${prob.answer}</strong>
      <div style="margin-top:0.5rem;color:var(--color-text-muted)">${prob.explanation || ''}</div>
    `;
  } else {
    fb.className = `problem-feedback show ${correct ? 'correct' : 'incorrect'}`;
    fb.innerHTML = `
      <div class="fb-label">${correct ? '✅ Correct!' : '✗ Not quite'}</div>
      ${correct ? '' : `<div>Your answer: <code>${userAnswer}</code></div>`}
      <div style="margin-top:0.4rem">${prob.explanation || ''}</div>
    `;
  }
}

// ── QUIZ ──────────────────────────────────────────────────────────────────────

function renderQuiz(section) {
  const questions = section.questions || [];
  const quizState = {
    currentQ: 0,
    answers: new Array(questions.length).fill(null),
    submitted: new Array(questions.length).fill(false),
    done: false,
  };

  function renderQ() {
    const q = questions[quizState.currentQ];
    const qi = quizState.currentQ;
    const answered = quizState.submitted[qi];
    const pct = Math.round(((qi + 1) / questions.length) * 100);

    let html = `
      <div class="quiz-container">
        ${breadcrumb()}
        <div class="section-type-banner banner-quiz">🎯 Quiz · ${questions.length} Questions</div>
        <h1>${section.title}</h1>
        <div class="quiz-progress-bar-wrap">
          <div class="quiz-progress-text">
            <span>Question ${qi + 1} of ${questions.length}</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="quiz-question-card">
          <div class="quiz-question-text">${renderContent(q.question)}</div>
          <div class="quiz-options" id="quiz-options"></div>
        </div>
        <div class="quiz-feedback" id="quiz-feedback"></div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
          <button class="btn btn-primary" id="submit-q" ${quizState.answers[qi] === null ? 'disabled' : ''}>
            ${answered ? 'Answered' : 'Submit Answer'}
          </button>
          ${answered && qi < questions.length - 1 ? `<button class="btn btn-secondary" id="next-q">Next Question →</button>` : ''}
          ${answered && qi === questions.length - 1 ? `<button class="btn btn-success" id="finish-q">See Results →</button>` : ''}
        </div>
      </div>
    `;
    mount(html);
    attachBreadcrumbListeners();

    // Render options
    const optContainer = document.getElementById('quiz-options');
    q.options.forEach((opt, oi) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      if (answered) {
        if (oi === q.answer) btn.classList.add('correct');
        else if (oi === quizState.answers[qi] && oi !== q.answer) btn.classList.add('incorrect');
        btn.disabled = true;
      } else if (quizState.answers[qi] === oi) {
        btn.classList.add('selected');
      }
      btn.innerHTML = `<span class="option-letter">${'ABCD'[oi]}</span> ${opt}`;
      if (!answered) {
        btn.addEventListener('click', () => {
          quizState.answers[qi] = oi;
          document.getElementById('submit-q').disabled = false;
          document.querySelectorAll('.quiz-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
        });
      }
      optContainer.appendChild(btn);
    });

    // Show feedback if already answered
    if (answered) {
      const fb = document.getElementById('quiz-feedback');
      const correct = quizState.answers[qi] === q.answer;
      fb.className = `quiz-feedback show ${correct ? 'correct' : 'incorrect'}`;
      fb.innerHTML = `${correct ? '✅ Correct!' : '✗ Incorrect'} — ${q.explanation || ''}`;
    }

    // Submit
    document.getElementById('submit-q')?.addEventListener('click', () => {
      if (quizState.answers[qi] === null || quizState.submitted[qi]) return;
      quizState.submitted[qi] = true;
      const correct = quizState.answers[qi] === q.answer;
      const fb = document.getElementById('quiz-feedback');
      fb.className = `quiz-feedback show ${correct ? 'correct' : 'incorrect'}`;
      fb.innerHTML = `${correct ? '✅ Correct!' : '✗ Incorrect'} — ${q.explanation || ''}`;
      renderQ(); // re-render to show next/finish
    });

    document.getElementById('next-q')?.addEventListener('click', () => {
      quizState.currentQ++;
      renderQ();
    });

    document.getElementById('finish-q')?.addEventListener('click', () => {
      submitQuiz();
    });
  }

  async function submitQuiz() {
    const answers = quizState.answers.map(a => a ?? 0);
    try {
      const result = await api.post(`/api/quiz/${section.id}`, { answers });
      state.progress[section.id] = { status: 'completed' };
      try { state.stats = await api.get('/api/stats'); } catch {}
      renderResults(result, section, questions);
    } catch (err) {
      alert('Could not submit quiz: ' + err.message);
    }
  }

  renderQ();
}

function renderResults(result, section, questions) {
  const { score, max_score, results } = result;
  const pct = Math.round((score / max_score) * 100);
  const stars = pct >= 100 ? '⭐⭐⭐' : pct >= 80 ? '⭐⭐' : pct >= 60 ? '⭐' : '';

  let html = `
    <div class="quiz-results">
      ${breadcrumb()}
      <div class="section-type-banner banner-quiz">🎯 Quiz Complete!</div>
      <h1>Results</h1>
      <div class="score-display">
        <div class="score-fraction">${score} / ${max_score}</div>
        <div class="score-percent">${pct}% correct</div>
        <div class="score-stars">${stars || '📚'}</div>
        <div style="font-size:0.85rem;color:var(--color-text-muted);margin-top:0.5rem">
          ${pct === 100 ? 'Perfect score! Outstanding work.' : pct >= 80 ? 'Great work — solid understanding.' : pct >= 60 ? 'Good effort. Review the explanations below.' : 'Keep at it — review the material and try again.'}
        </div>
      </div>
      <div class="results-detail">
        <h3>Question Review</h3>
  `;

  results.forEach((r, i) => {
    const q = questions[i];
    html += `
      <div class="result-item ${r.is_correct ? 'correct' : 'incorrect'}">
        <div class="result-q">${r.is_correct ? '✅' : '✗'} Q${i+1}: ${q.question.substring(0, 80)}${q.question.length > 80 ? '…' : ''}</div>
        ${!r.is_correct ? `<div class="result-meta">Your answer: ${q.options[r.submitted]} | Correct: ${q.options[r.correct]}</div>` : ''}
        <div class="result-meta" style="margin-top:0.2rem">${q.explanation || ''}</div>
      </div>
    `;
  });

  html += `
      </div>
      <div class="results-actions">
        <button class="btn btn-secondary" id="retry-quiz">↺ Try Again</button>
        <button class="btn btn-primary" id="back-to-unit">Return to Unit</button>
      </div>
    </div>
  `;

  mount(html);
  attachBreadcrumbListeners();

  document.getElementById('retry-quiz').addEventListener('click', () => {
    navigate('section', { expId: state.currentExpId, unitId: state.currentUnitId, sectionId: section.id });
  });
  document.getElementById('back-to-unit').addEventListener('click', () => {
    navigate('unit', { expId: state.currentExpId, unitId: state.currentUnitId });
  });
}

// ── BOOT ──────────────────────────────────────────────────────────────────────

init();
