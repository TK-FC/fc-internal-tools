import React, { useState, useMemo, useEffect } from 'react';
import { Activity, AlertCircle, CheckCircle2, Clock, DollarSign, Zap, RefreshCw, ExternalLink, User, FileText, Search, LayoutGrid, Layers, X, Link as LinkIcon, ListChecks, BookOpen, ChevronRight, Package, Lock, Unlock, ArrowLeft, CircleDot, Loader2 } from 'lucide-react';
import { fetchProjects } from './lib/fetchProjects';
import { triggerHealthCheck } from './lib/worker';


const STAGES = [
  { key: 'ideation', label: 'Ideation', short: 'Idea' },
  { key: 'building', label: 'Building', short: 'Build' },
  { key: 'finalisation', label: 'Finalisation', short: 'Final' },
  { key: 'released', label: 'Released', short: 'Live' }
];

const HEALTH_CONFIG = {
  green: { label: 'Online', color: '#7DD87D', bg: 'rgba(125, 216, 125, 0.12)' },
  amber: { label: 'Degraded', color: '#FFB547', bg: 'rgba(255, 181, 71, 0.12)' },
  red: { label: 'Down', color: '#FF6B6B', bg: 'rgba(255, 107, 107, 0.12)' },
  none: { label: 'Not deployed', color: '#6B6B6B', bg: 'rgba(255, 255, 255, 0.04)' }
};

const STAGE_COLORS = {
  ideation: '#888888',
  building: '#FFD23F',
  finalisation: '#FFB547',
  released: '#7DD87D'
};

const YELLOW = '#FFD23F';
const BG = '#0F0F0F';
const PANEL = '#1A1A1A';
const PANEL_HOVER = '#222';
const BORDER = '#2A2A2A';
const TEXT = '#F5F5F5';
const TEXT_DIM = '#888';
const TEXT_FAINT = '#5A5A5A';

function formatTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' });
}
function formatCurrency(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

function rollupStage(modules) {
  if (!modules || modules.length === 0) return 'ideation';
  const order = STAGES.map(s => s.key);
  const stages = modules.map(m => m.stage);
  return stages.reduce((lowest, s) => order.indexOf(s) < order.indexOf(lowest) ? s : lowest, stages[0]);
}
function effectiveStage(project) {
  if (project.stageMode === 'auto' && project.modules.length > 0) return rollupStage(project.modules);
  return project.stage;
}
function rollupHealth(modules) {
  if (!modules || modules.length === 0) return 'none';
  const order = { red: 0, amber: 1, green: 2, none: 3 };
  return modules.reduce((worst, m) => order[m.healthStatus] < order[worst] ? m.healthStatus : worst, 'none');
}
function projectHealth(project) {
  return project.modules.length === 0 ? 'none' : rollupHealth(project.modules);
}

export default function AIDashboard() {
  const [view, setView] = useState({ level: 'projects' });
  const [stageFilter, setStageFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('category');
  const [refreshing, setRefreshing] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  // Data state (replaces MOCK_PROJECTS)
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  // Load on mount
  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProjects() {
    setError(null);
    try {
      const data = await fetchProjects();
      setProjects(data);
      setLastFetched(new Date());
    } catch (err) {
      console.error('[Dashboard] fetchProjects failed:', err);
      setError(err.message || 'Failed to load projects');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const toggleGroup = (key) => setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const handleRefresh = () => {
    setRefreshing(true);
    loadProjects();
  };

  const filtered = useMemo(() => projects.filter(p => {
    const stage = effectiveStage(p);
    const health = projectHealth(p);
    if (stageFilter !== 'all' && stage !== stageFilter) return false;
    if (healthFilter === 'online' && health !== 'green') return false;
    if (healthFilter === 'issues' && health !== 'amber' && health !== 'red') return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [projects, stageFilter, healthFilter, search]);

  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null, projects: filtered }];
    const map = new Map();
    filtered.forEach(p => {
      const key = groupBy === 'category' ? p.category : effectiveStage(p);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
    const groups = Array.from(map.entries()).map(([key, projects]) => ({
      key, label: groupBy === 'stage' ? (STAGES.find(s => s.key === key)?.label || key) : key, projects
    }));
    if (groupBy === 'stage') {
      const order = STAGES.map(s => s.key);
      groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    } else { groups.sort((a, b) => a.label.localeCompare(b.label)); }
    return groups;
  }, [filtered, groupBy]);

  const totals = useMemo(() => {
    const allModules = projects.flatMap(p => p.modules);
    return {
      projects: projects.length,
      modules: allModules.length,
      online: allModules.filter(m => m.healthStatus === 'green').length,
      issues: allModules.filter(m => m.healthStatus === 'amber' || m.healthStatus === 'red').length,
      monthlyCost: projects.reduce((s, p) => s + p.monthlyCost, 0),
      monthlyCalls: projects.reduce((s, p) => s + p.callsThisMonth, 0)
    };
  }, [projects]);

  const toggleHealth = (target) => setHealthFilter(prev => prev === target ? 'all' : target);

  const selectedProject = view.level !== 'projects' ? projects.find(p => p.id === view.id || p.id === view.projectId) : null;
  const selectedModule = view.level === 'module' ? selectedProject?.modules.find(m => m.id === view.moduleId) : null;

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: '"Inter", -apple-system, sans-serif', color: TEXT }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
        .display-font { font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.02em; }
        .pulse-dot { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .card-hover { transition: all 0.18s ease; cursor: pointer; }
        .card-hover:hover { background: ${PANEL_HOVER}; border-color: ${YELLOW}; }
        .module-row:hover { background: #1F1F1F; }
        .spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        .slide-in { animation: slideIn 0.2s ease; }
        input::placeholder { color: ${TEXT_FAINT}; }
        button { font-family: inherit; }

        /* Mobile-first responsive */
        .main-padding { padding: 28px 40px; }
        .header-padding { padding: 20px 40px; }
        .filter-bar { flex-wrap: wrap; }
        .actionable-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px; }
        .read-only-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
        .project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }

        @media (max-width: 700px) {
          .main-padding { padding: 18px 16px; }
          .header-padding { padding: 16px 16px; }
          .read-only-stats { grid-template-columns: repeat(2, 1fr); }
          .project-grid { grid-template-columns: 1fr; }
          .hide-mobile { display: none; }
          .stack-mobile { flex-direction: column; align-items: stretch !important; }
          .stack-mobile > * { width: 100%; }
        }
      `}</style>

      {/* Header */}
      <header style={{ background: PANEL, borderBottom: `1px solid ${BORDER}`, position: 'relative' }} className="header-padding">
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${YELLOW}, transparent)` }} />
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, background: YELLOW, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: BG, flexShrink: 0 }}>
              <Zap size={18} strokeWidth={2.5} />
            </div>
            <div>
              <div className="display-font" style={{ fontSize: 20, fontWeight: 700 }}>Foodie Coaches</div>
              <div style={{ fontSize: 10, color: YELLOW, textTransform: 'uppercase', letterSpacing: '0.18em', fontWeight: 600 }}>AI Project Dashboard</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="hide-mobile" style={{ fontSize: 11, color: TEXT_DIM, textAlign: 'right' }}>
              <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last refresh</div>
              <div style={{ color: TEXT, fontWeight: 500, fontSize: 13, marginTop: 2 }}>
                {lastFetched ? lastFetched.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
              </div>
            </div>
            <button onClick={handleRefresh} style={{ background: YELLOW, color: BG, border: 'none', padding: '9px 14px', borderRadius: 4, fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={13} className={refreshing ? 'spin' : ''} strokeWidth={2.5} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1400, margin: '0 auto' }} className="main-padding">
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 14 }}>
            <Loader2 size={28} className="spin" style={{ color: YELLOW }} strokeWidth={2} />
            <div style={{ fontSize: 12, color: TEXT_DIM, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }}>Loading projects…</div>
          </div>
        )}

        {!loading && error && (
          <div style={{ background: HEALTH_CONFIG.red.bg, border: `1px solid ${HEALTH_CONFIG.red.color}`, borderRadius: 6, padding: 20, marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <AlertCircle size={20} style={{ color: HEALTH_CONFIG.red.color, flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: HEALTH_CONFIG.red.color, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: 4 }}>Couldn't load projects</div>
              <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.5, marginBottom: 12, wordBreak: 'break-word' }}>{error}</div>
              <button onClick={handleRefresh} style={{ padding: '7px 12px', border: `1px solid ${HEALTH_CONFIG.red.color}`, background: 'transparent', color: HEALTH_CONFIG.red.color, borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={11} /> Try again
              </button>
            </div>
          </div>
        )}

        {!loading && !error && (<>
        {view.level !== 'projects' && <Breadcrumb view={view} project={selectedProject} module={selectedModule} onNav={setView} />}

        {view.level === 'projects' && (
          <>
            {/* Actionable stats (filters) — visually distinct */}
            <div className="actionable-stats">
              <ActionableStatCard label="Online" value={totals.online} icon={<CheckCircle2 size={18} />} accent="#7DD87D" active={healthFilter === 'online'} onClick={() => toggleHealth('online')} />
              <ActionableStatCard label="Issues" value={totals.issues} icon={<AlertCircle size={18} />} accent="#FF6B6B" active={healthFilter === 'issues'} onClick={() => totals.issues > 0 && toggleHealth('issues')} disabled={totals.issues === 0} />
            </div>

            {/* Read-only stats — compact */}
            <div className="read-only-stats">
              <ReadOnlyStat label="Projects" value={totals.projects} icon={<Package size={13} />} />
              <ReadOnlyStat label="Modules" value={totals.modules} icon={<Layers size={13} />} />
              <ReadOnlyStat label="Cost / mo" value={formatCurrency(totals.monthlyCost)} icon={<DollarSign size={13} />} accent={YELLOW} />
              <ReadOnlyStat label="Calls (MTD)" value={totals.monthlyCalls.toLocaleString()} icon={<Activity size={13} />} />
            </div>

            {/* Filter bar */}
            <div className="filter-bar" style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
                <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TEXT_DIM }} />
                <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', padding: '9px 11px 9px 34px', border: `1px solid ${BORDER}`, borderRadius: 4, background: PANEL, fontSize: 13, fontFamily: 'inherit', color: TEXT, outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <FilterChip label="Cat" active={groupBy === 'category'} onClick={() => setGroupBy('category')} icon={<LayoutGrid size={11} />} />
                <FilterChip label="Stage" active={groupBy === 'stage'} onClick={() => setGroupBy('stage')} icon={<Layers size={11} />} />
                <FilterChip label="None" active={groupBy === 'none'} onClick={() => setGroupBy('none')} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
                <FilterChip label="All" active={stageFilter === 'all'} onClick={() => setStageFilter('all')} />
                {STAGES.map(s => <FilterChip key={s.key} label={s.short} active={stageFilter === s.key} onClick={() => setStageFilter(s.key)} />)}
              </div>
            </div>

            {/* Groups */}
            {grouped.map(group => <GroupSection key={group.key} group={group} collapsed={collapsedGroups.has(group.key)} onToggle={() => toggleGroup(group.key)} onProjectClick={(id) => setView({ level: 'project', id })} />)}
            {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '60px 20px', color: TEXT_DIM }}>No projects match your filters.</div>}
          </>
        )}

        {view.level === 'project' && selectedProject && <ProjectDetail project={selectedProject} onOpenModule={(moduleId) => setView({ level: 'module', projectId: selectedProject.id, moduleId })} />}
        {view.level === 'module' && selectedModule && selectedProject && <ModuleDetail module={selectedModule} project={selectedProject} onCheckNow={loadProjects} />}
        {view.level !== 'projects' && !selectedProject && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: TEXT_DIM, fontSize: 13 }}>
            That project no longer exists. <button onClick={() => setView({ level: 'projects' })} style={{ background: 'transparent', border: 'none', color: YELLOW, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>Back to all projects</button>
          </div>
        )}
        </>)}
      </main>
    </div>
  );
}

// ============================================================
// GROUP SECTION (smarter headers)
// ============================================================

function GroupSection({ group, collapsed, onToggle, onProjectClick }) {
  if (!group.label) {
    return (
      <div className="project-grid">
        {group.projects.map(p => <ProjectCard key={p.id} project={p} onClick={() => onProjectClick(p.id)} />)}
      </div>
    );
  }

  // Compute group-level health summary
  const healthCounts = group.projects.reduce((acc, p) => {
    const h = projectHealth(p);
    acc[h] = (acc[h] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ marginBottom: 28 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, cursor: 'pointer', userSelect: 'none' }}>
        <ChevronRight size={14} style={{ color: TEXT_DIM, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s ease', flexShrink: 0 }} />
        <h2 className="display-font" style={{ fontSize: 14, fontWeight: 700, margin: 0, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{group.label}</h2>
        <span style={{ fontSize: 11, color: TEXT_FAINT, fontWeight: 500, padding: '2px 8px', background: PANEL, borderRadius: 10 }}>{group.projects.length}</span>
        <div style={{ height: 1, flex: 1, background: BORDER }} />
        <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
          {healthCounts.green > 0 && <span style={{ color: HEALTH_CONFIG.green.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: HEALTH_CONFIG.green.color }}></span>{healthCounts.green}</span>}
          {(healthCounts.amber > 0 || healthCounts.red > 0) && <span style={{ color: HEALTH_CONFIG.red.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: HEALTH_CONFIG.red.color }}></span>{(healthCounts.amber || 0) + (healthCounts.red || 0)}</span>}
          {healthCounts.none > 0 && <span style={{ color: TEXT_FAINT, fontWeight: 500 }}>{healthCounts.none} pending</span>}
        </div>
      </div>
      {!collapsed && (
        <div className="project-grid">
          {group.projects.map(p => <ProjectCard key={p.id} project={p} onClick={() => onProjectClick(p.id)} />)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// BREADCRUMB
// ============================================================

function Breadcrumb({ view, project, module: mod, onNav }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, fontSize: 13, flexWrap: 'wrap' }}>
      <button onClick={() => onNav({ level: 'projects' })} style={{ background: 'transparent', border: 'none', color: TEXT_DIM, cursor: 'pointer', padding: '5px 8px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
        <ArrowLeft size={13} /> All Projects
      </button>
      {project && (
        <>
          <ChevronRight size={12} color={TEXT_FAINT} />
          <button onClick={() => onNav({ level: 'project', id: project.id })} style={{ background: 'transparent', border: 'none', color: view.level === 'project' ? TEXT : TEXT_DIM, cursor: 'pointer', padding: '5px 8px', borderRadius: 4, fontWeight: view.level === 'project' ? 600 : 400, fontSize: 12 }}>
            {project.name}
          </button>
        </>
      )}
      {mod && (<><ChevronRight size={12} color={TEXT_FAINT} /><span style={{ color: TEXT, fontWeight: 600, padding: '5px 8px', fontSize: 12 }}>{mod.name}</span></>)}
    </div>
  );
}

// ============================================================
// STAT CARDS — TWO VARIANTS
// ============================================================

// Big, prominent — for filterable actions
function ActionableStatCard({ label, value, icon, accent, active, onClick, disabled }) {
  const isClickable = !!onClick && !disabled;
  return (
    <div
      onClick={isClickable ? onClick : undefined}
      style={{
        background: active ? `${accent}18` : PANEL, padding: '14px 18px', borderRadius: 6,
        border: `1px solid ${active ? accent : BORDER}`, position: 'relative', overflow: 'hidden',
        cursor: isClickable ? 'pointer' : 'default', opacity: disabled ? 0.4 : 1, transition: 'all 0.15s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
      }}
      onMouseEnter={(e) => { if (isClickable && !active) e.currentTarget.style.background = '#222'; }}
      onMouseLeave={(e) => { if (isClickable) e.currentTarget.style.background = active ? `${accent}18` : PANEL; }}
    >
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, color: TEXT_DIM, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}
          {isClickable && <span style={{ fontSize: 8, color: active ? accent : TEXT_FAINT, fontWeight: 600 }}>{active ? '× CLEAR' : 'TAP TO FILTER'}</span>}
        </div>
        <div className="display-font" style={{ fontSize: 28, fontWeight: 700, color: accent, lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ width: 40, height: 40, borderRadius: 4, background: `${accent}15`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
    </div>
  );
}

// Compact — for context-only data
function ReadOnlyStat({ label, value, icon, accent }) {
  return (
    <div style={{ background: PANEL, padding: '10px 12px', borderRadius: 4, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ color: accent || TEXT_FAINT, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, color: TEXT_FAINT }}>{label}</div>
        <div className="display-font" style={{ fontSize: 15, fontWeight: 600, color: accent || TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick, icon }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 10px', border: `1px solid ${active ? YELLOW : BORDER}`, background: active ? YELLOW : 'transparent', color: active ? BG : TEXT, borderRadius: 4, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
      {icon}{label}
    </button>
  );
}

// ============================================================
// THIN PIPELINE BAR (the big visual win)
// ============================================================

function ThinPipeline({ stage, showLabels }) {
  const currentIdx = STAGES.findIndex(s => s.key === stage);
  return (
    <div style={{ width: '100%' }}>
      {showLabels && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          {STAGES.map((s, idx) => {
            const isCurrent = idx === currentIdx;
            return (
              <span key={s.key} style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: isCurrent ? STAGE_COLORS[s.key] : (idx < currentIdx ? TEXT_DIM : TEXT_FAINT) }}>
                {s.short}
              </span>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 3, width: '100%' }}>
        {STAGES.map((s, idx) => {
          const isActive = idx <= currentIdx;
          const isCurrent = idx === currentIdx;
          const c = STAGE_COLORS[s.key];
          return (
            <div key={s.key} style={{
              flex: 1, height: 5, borderRadius: 2,
              background: isActive ? c : '#252525',
              opacity: isActive && !isCurrent ? 0.5 : 1,
              boxShadow: isCurrent ? `0 0 8px ${c}55` : 'none'
            }} />
          );
        })}
      </div>
    </div>
  );
}

// Larger pipeline for detail pages — keeps the original block style as the "hero" element
function PipelineLarge({ stage }) {
  const currentIdx = STAGES.findIndex(s => s.key === stage);
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      {STAGES.map((s, idx) => {
        const isActive = idx <= currentIdx;
        const isCurrent = idx === currentIdx;
        const c = STAGE_COLORS[s.key];
        return (
          <React.Fragment key={s.key}>
            <div style={{ flex: 1, height: 32, background: isActive ? c : '#1F1F1F', border: `1px solid ${isActive ? c : BORDER}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: isCurrent ? BG : (isActive ? TEXT : TEXT_FAINT), opacity: isActive && !isCurrent ? 0.55 : 1 }}>{s.label}</div>
            {idx < STAGES.length - 1 && <div style={{ width: 8, height: 2, background: idx < currentIdx ? STAGE_COLORS[STAGES[idx].key] : BORDER, opacity: idx < currentIdx ? 0.55 : 1 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function HealthPill({ status, small }) {
  const h = HEALTH_CONFIG[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: small ? 10 : 11, fontWeight: 600, color: h.color, padding: small ? '2px 6px' : '3px 8px', background: h.bg, borderRadius: 3 }}>
      <span className={status === 'green' ? 'pulse-dot' : ''} style={{ width: small ? 5 : 6, height: small ? 5 : 6, borderRadius: '50%', background: h.color }}></span>
      {h.label}
    </div>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: TEXT_FAINT, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 3 }}>{icon} {label}</div>
      <div style={{ fontSize: 12.5, color: TEXT, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children, icon, right }) {
  return (
    <div style={{ fontSize: 11, color: TEXT_DIM, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon}{children}
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

// Module stage preview dots — strip of mini indicators on project cards
function ModulePreview({ modules }) {
  if (modules.length === 0) {
    return <div style={{ fontSize: 11, color: TEXT_FAINT, fontStyle: 'italic' }}>Single-unit project (no modules)</div>;
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
          {modules.length} {modules.length === 1 ? 'module' : 'modules'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {modules.map((m) => {
          const stageLabel = STAGES.find(s => s.key === m.stage)?.label || m.stage;
          return (
            <div key={m.id} title={`${m.name} — ${stageLabel}`} style={{
              flex: 1, height: 8, borderRadius: 2, background: STAGE_COLORS[m.stage],
              minWidth: 12
            }} />
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// PROJECT CARD — denser, with module preview
// ============================================================

function ProjectCard({ project, onClick }) {
  const stage = effectiveStage(project);
  const health = projectHealth(project);
  const moduleIssues = project.modules.filter(m => m.healthStatus === 'amber' || m.healthStatus === 'red').length;

  return (
    <div className="card-hover" onClick={onClick} style={{ background: PANEL, borderRadius: 6, border: `1px solid ${BORDER}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Row 1: category + health */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: YELLOW }}>{project.category}</span>
        <HealthPill status={health} />
      </div>

      {/* Row 2: name + desc */}
      <div>
        <h3 className="display-font" style={{ fontSize: 16, fontWeight: 600, margin: 0, color: TEXT, lineHeight: 1.25 }}>{project.name}</h3>
        <p style={{ fontSize: 12, color: TEXT_DIM, margin: '4px 0 0', lineHeight: 1.45 }}>{project.description}</p>
      </div>

      {/* Row 3: thin pipeline with labels */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 9, color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>Pipeline</span>
          <span style={{ fontSize: 9, color: project.stageMode === 'auto' ? YELLOW : TEXT_FAINT, display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
            {project.stageMode === 'auto' ? <><Unlock size={9} /> AUTO</> : <><Lock size={9} /> MANUAL</>}
          </span>
        </div>
        <ThinPipeline stage={stage} showLabels />
      </div>

      {/* Row 4: module preview strip */}
      <ModulePreview modules={project.modules} />

      {/* Row 5: issues alert if any */}
      {moduleIssues > 0 && (
        <div style={{ padding: '6px 9px', background: HEALTH_CONFIG.red.bg, borderRadius: 4, fontSize: 11, color: HEALTH_CONFIG.red.color, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertCircle size={12} />{moduleIssues} module{moduleIssues > 1 ? 's' : ''} with issues
        </div>
      )}

      {/* Row 6: footer stats — only 2, not 4 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: `1px solid ${BORDER}`, fontSize: 11, color: TEXT_DIM }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><User size={11} /> {project.owner}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><DollarSign size={11} /> {formatCurrency(project.monthlyCost)}/mo</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Activity size={11} /> {project.callsThisMonth.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ============================================================
// PROJECT DETAIL
// ============================================================

function ProjectDetail({ project, onOpenModule }) {
  const stage = effectiveStage(project);
  const health = projectHealth(project);

  return (
    <div className="slide-in">
      <div style={{ background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, padding: 24, marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: YELLOW }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: YELLOW }}>{project.category}</span>
          <span style={{ color: BORDER }}>|</span>
          <span style={{ fontSize: 11, color: TEXT_DIM }}>Owner: {project.owner}</span>
          <div style={{ marginLeft: 'auto' }}><HealthPill status={health} /></div>
        </div>
        <h2 className="display-font" style={{ fontSize: 26, fontWeight: 700, margin: 0, color: TEXT, lineHeight: 1.15 }}>{project.name}</h2>
        <p style={{ fontSize: 13.5, color: TEXT_DIM, margin: '8px 0 20px', lineHeight: 1.5 }}>{project.description}</p>

        <SectionLabel right={
          <span style={{ fontSize: 10, color: project.stageMode === 'auto' ? YELLOW : TEXT_FAINT, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
            {project.stageMode === 'auto' ? <><Unlock size={10} /> AUTO (from modules)</> : <><Lock size={10} /> MANUAL</>}
          </span>
        }>Pipeline</SectionLabel>
        <PipelineLarge stage={stage} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 14, marginTop: 20, paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
          <Stat icon={<DollarSign size={11} />} label="Monthly" value={formatCurrency(project.monthlyCost)} />
          <Stat icon={<Activity size={11} />} label="Calls (MTD)" value={project.callsThisMonth.toLocaleString()} />
          <Stat icon={<Layers size={11} />} label="Modules" value={project.modules.length} />
          <Stat icon={<LinkIcon size={11} />} label="Status" value={project.projectLink ? 'Live' : 'Not deployed'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={{ background: PANEL, borderRadius: 6, border: `1px solid ${BORDER}`, padding: 18 }}>
          <SectionLabel icon={<BookOpen size={12} />}>Brief</SectionLabel>
          <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.55 }}>{project.brief}</div>
          {project.projectLink && (
            <a href={project.projectLink} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '7px 11px', border: `1px solid ${YELLOW}`, borderRadius: 4, color: YELLOW, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
              <LinkIcon size={12} /> Open project <ExternalLink size={10} />
            </a>
          )}
        </div>
        <div style={{ background: PANEL, borderRadius: 6, border: `1px solid ${BORDER}`, padding: 18 }}>
          <SectionLabel icon={<ListChecks size={12} />}>Feature Wish List</SectionLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {project.wishList.map((item, idx) => (
              <li key={idx} style={{ padding: '7px 11px', background: BG, borderRadius: 4, border: `1px solid ${BORDER}`, fontSize: 12.5, color: TEXT, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                <span style={{ flexShrink: 0, width: 15, height: 15, borderRadius: 3, background: `${YELLOW}20`, color: YELLOW, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, marginTop: 1 }}>{idx + 1}</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Modules — now dense rows instead of cards */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 className="display-font" style={{ fontSize: 14, fontWeight: 700, margin: 0, color: TEXT, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Modules</h3>
        <span style={{ fontSize: 11, color: TEXT_FAINT, padding: '2px 8px', background: PANEL, borderRadius: 10 }}>{project.modules.length}</span>
        <div style={{ height: 1, flex: 1, background: BORDER }} />
      </div>

      {project.modules.length === 0 ? (
        <div style={{ background: PANEL, borderRadius: 6, border: `1px dashed ${BORDER}`, padding: 28, textAlign: 'center', color: TEXT_DIM, fontSize: 13 }}>
          No modules yet. This project is being built as a single unit.
        </div>
      ) : (
        <div style={{ background: PANEL, borderRadius: 6, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          {project.modules.map((m, idx) => <ModuleRow key={m.id} module={m} onClick={() => onOpenModule(m.id)} isLast={idx === project.modules.length - 1} />)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MODULE ROW — dense list view (replaces module cards)
// ============================================================

function ModuleRow({ module: mod, onClick, isLast }) {
  const taskCount = mod.tasks?.length || 0;
  const tasksDone = mod.tasks?.filter(t => t.done).length || 0;
  const stageIdx = STAGES.findIndex(s => s.key === mod.stage);

  return (
    <div className="module-row" onClick={onClick} style={{ padding: '14px 18px', borderBottom: isLast ? 'none' : `1px solid ${BORDER}`, cursor: 'pointer', display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto', gap: 16, alignItems: 'center', transition: 'background 0.15s' }}>
      <Package size={14} style={{ color: TEXT_FAINT }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span className="display-font" style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{mod.name}</span>
          {mod.lastError && <span style={{ fontSize: 10, color: HEALTH_CONFIG[mod.healthStatus].color, fontWeight: 500 }}>· {mod.lastError}</span>}
        </div>
        <div style={{ width: 180 }}><ThinPipeline stage={mod.stage} /></div>
      </div>
      <div style={{ fontSize: 11, color: TEXT_DIM, textAlign: 'right', fontWeight: 500, minWidth: 60 }}>
        {STAGES[stageIdx]?.label}
      </div>
      <div style={{ minWidth: 90, display: 'flex', justifyContent: 'flex-end' }}><HealthPill status={mod.healthStatus} small /></div>
      <ChevronRight size={14} style={{ color: TEXT_FAINT }} />
    </div>
  );
}

// ============================================================
// MODULE DETAIL
// ============================================================

function ModuleDetail({ module: mod, project, onCheckNow }) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  async function handleCheckNow() {
    setChecking(true);
    setCheckError(null);
    setLastResult(null);
    try {
      const result = await triggerHealthCheck(mod.id);
      setLastResult(result);
      // Refetch projects so the new health status flows through the UI
      if (onCheckNow) await onCheckNow();
    } catch (err) {
      console.error('[Check now] failed:', err);
      setCheckError(err.message || 'Health check failed');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="slide-in">
      <div style={{ background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, padding: 24, marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: YELLOW }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: YELLOW, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Package size={11} /> Module of {project.name}
          </span>
          <div style={{ marginLeft: 'auto' }}><HealthPill status={mod.healthStatus} /></div>
        </div>
        <h2 className="display-font" style={{ fontSize: 24, fontWeight: 700, margin: 0, color: TEXT, lineHeight: 1.15 }}>{mod.name}</h2>
        <p style={{ fontSize: 13, color: TEXT_DIM, margin: '8px 0 20px', lineHeight: 1.5 }}>{mod.brief}</p>

        <SectionLabel>Pipeline</SectionLabel>
        <PipelineLarge stage={mod.stage} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14, marginTop: 20, paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
          <Stat icon={<Clock size={11} />} label="Last check" value={formatTime(mod.lastHealthCheck)} />
          <Stat icon={<LinkIcon size={11} />} label="Endpoint" value={mod.endpoint ? 'Configured' : 'None'} />
          <Stat icon={<CircleDot size={11} />} label="Tasks" value={mod.tasks?.length > 0 ? `${mod.tasks.filter(t => t.done).length}/${mod.tasks.length}` : '—'} />
        </div>
      </div>

      {mod.endpoint && (
        <div style={{ background: PANEL, borderRadius: 6, border: `1px solid ${BORDER}`, padding: 18, marginBottom: 12 }}>
          <SectionLabel icon={<LinkIcon size={12} />}>Endpoint</SectionLabel>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: TEXT, padding: '9px 11px', background: BG, borderRadius: 4, border: `1px solid ${BORDER}`, wordBreak: 'break-all', marginBottom: 10 }}>{mod.endpoint}</div>
          <button
            onClick={handleCheckNow}
            disabled={checking}
            style={{
              padding: '7px 11px', border: `1px solid ${YELLOW}`,
              background: checking ? 'transparent' : YELLOW,
              color: checking ? YELLOW : BG,
              borderRadius: 4, fontSize: 12, fontWeight: 600,
              cursor: checking ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: checking ? 0.7 : 1
            }}
          >
            <RefreshCw size={11} className={checking ? 'spin' : ''} />
            {checking ? 'Checking…' : 'Check now'}
          </button>

          {mod.lastError && !checking && !lastResult && (
            <div style={{ marginTop: 10, padding: '7px 10px', background: HEALTH_CONFIG.red.bg, borderRadius: 4, fontSize: 11.5, color: HEALTH_CONFIG.red.color, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span><strong>Last error:</strong> {mod.lastError}</span>
            </div>
          )}

          {checkError && (
            <div style={{ marginTop: 10, padding: '7px 10px', background: HEALTH_CONFIG.red.bg, borderRadius: 4, fontSize: 11.5, color: HEALTH_CONFIG.red.color, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span><strong>Couldn't run check:</strong> {checkError}</span>
            </div>
          )}

          {lastResult && lastResult.results?.[0] && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: HEALTH_CONFIG[lastResult.results[0].status]?.bg || BG, borderRadius: 4, fontSize: 11.5, color: HEALTH_CONFIG[lastResult.results[0].status]?.color || TEXT, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <CheckCircle2 size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>{HEALTH_CONFIG[lastResult.results[0].status]?.label || 'Result'}</strong>
                {lastResult.results[0].response_time_ms != null && ` · ${lastResult.results[0].response_time_ms}ms`}
                {lastResult.results[0].error && ` · ${lastResult.results[0].error}`}
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ background: PANEL, borderRadius: 6, border: `1px solid ${BORDER}`, padding: 18 }}>
        <SectionLabel icon={<ListChecks size={12} />}>Tasks</SectionLabel>
        {(mod.tasks?.length || 0) === 0 ? (
          <div style={{ fontSize: 13, color: TEXT_FAINT, fontStyle: 'italic' }}>No tasks yet for this module.</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mod.tasks.map((t) => (
              <li key={t.id} style={{ padding: '8px 12px', background: BG, borderRadius: 4, border: `1px solid ${BORDER}`, fontSize: 12.5, color: t.done ? TEXT_DIM : TEXT, display: 'flex', alignItems: 'center', gap: 9, textDecoration: t.done ? 'line-through' : 'none' }}>
                <span style={{ flexShrink: 0, width: 15, height: 15, borderRadius: 3, background: t.done ? `${HEALTH_CONFIG.green.color}30` : 'transparent', border: `1px solid ${t.done ? HEALTH_CONFIG.green.color : BORDER}`, color: HEALTH_CONFIG.green.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{t.done ? '✓' : ''}</span>
                {t.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}