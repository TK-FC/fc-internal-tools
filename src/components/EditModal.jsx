import React, { useState, useEffect } from 'react';
import { X, Save, Loader2, AlertCircle, Archive, RotateCcw, Plus, Trash2 } from 'lucide-react';
import {
  createProject, updateProject, archiveProject, restoreProject,
  createModule, updateModule, archiveModule, restoreModule
} from '../lib/crud';

// Theme constants — match App.jsx
const YELLOW = '#FFD23F';
const BG = '#0F0F0F';
const PANEL = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#F5F5F5';
const TEXT_DIM = '#888';
const TEXT_FAINT = '#5A5A5A';
const RED = '#FF6B6B';

const STAGES = [
  { key: 'ideation', label: 'Ideation' },
  { key: 'building', label: 'Building' },
  { key: 'finalisation', label: 'Finalisation' },
  { key: 'released', label: 'Released' }
];

const CATEGORIES = ['General AI Chatbots', 'Internal Ops', 'Numbers', 'Marketing', 'People'];

// ============================================================
// EditModal
//   props.kind:    'project' | 'module'
//   props.mode:    'create' | 'edit'
//   props.item:    existing item (edit mode only)
//   props.project: parent project (module create/edit only — for context)
//   props.onClose: () => void
//   props.onSaved: () => Promise<void>  — refetches projects in the parent
// ============================================================
export function EditModal({ kind, mode, item, project, onClose, onSaved }) {
  const isProject = kind === 'project';
  const isEdit = mode === 'edit';

  // -------- form state --------
  const [name, setName] = useState(item?.name || '');
  const [stage, setStage] = useState(item?.stage || 'ideation');

  // Project-only
  const [category, setCategory] = useState(item?.category || CATEGORIES[0]);
  const [owner, setOwner] = useState(item?.owner || 'Sam');
  const [stageMode, setStageMode] = useState(item?.stageMode || 'manual');
  const [description, setDescription] = useState(item?.description || '');
  const [briefText, setBriefText] = useState(item?.brief || '');
  const [projectLink, setProjectLink] = useState(item?.projectLink || '');
  const [monthlyCost, setMonthlyCost] = useState(item?.monthlyCost ?? 0);
  const [callsThisMonth, setCallsThisMonth] = useState(item?.callsThisMonth ?? 0);
  const [wishList, setWishList] = useState(item?.wishList || []);
  const [wishInput, setWishInput] = useState('');

  // Endpoint — used by both projects and modules
  const [endpoint, setEndpoint] = useState(item?.endpoint || '');

  // Module-only
  const [moduleBrief, setModuleBrief] = useState(item?.brief || '');

  // -------- ui state --------
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  // Lock body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function addWishItem() {
    const v = wishInput.trim();
    if (!v) return;
    setWishList([...wishList, v]);
    setWishInput('');
  }
  function removeWishItem(idx) {
    setWishList(wishList.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      if (isProject) {
        const fields = {
          name: name.trim(),
          category, owner, stage, stage_mode: stageMode,
          description: description.trim() || null,
          brief: briefText.trim() || null,
          project_link: projectLink.trim() || null,
          monthly_cost: Number(monthlyCost) || 0,
          calls_this_month: Number(callsThisMonth) || 0,
          wish_list: wishList,
          endpoint: endpoint.trim() || null
        };
        if (isEdit) await updateProject(item.id, fields);
        else        await createProject(fields);
      } else {
        const fields = {
          name: name.trim(),
          stage,
          module_brief: moduleBrief.trim() || null,
          endpoint: endpoint.trim() || null
        };
        if (isEdit) {
          await updateModule(item.id, fields);
        } else {
          if (!project?.id) throw new Error('Missing parent project');
          await createModule({ ...fields, parent_id: project.id });
        }
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setSaving(true);
    setError(null);
    try {
      if (isProject) await archiveProject(item.id);
      else           await archiveModule(item.id);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Archive failed');
      setSaving(false);
    }
  }

  const title =
    isEdit
      ? `Edit ${isProject ? 'project' : 'module'}`
      : `New ${isProject ? 'project' : 'module'}${!isProject && project ? ` in ${project.name}` : ''}`;

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={accentBarStyle} />

        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div style={kickerStyle}>{isEdit ? 'Editing' : 'Creating'}</div>
            <div className="display-font" style={titleStyle}>{title}</div>
          </div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          <Field label="Name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
          </Field>

          {isProject && (
            <>
              <Row>
                <Field label="Category" required>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Owner" required>
                  <input value={owner} onChange={(e) => setOwner(e.target.value)} style={inputStyle} />
                </Field>
              </Row>

              <Row>
                <Field label="Stage">
                  <select value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle}>
                    {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Stage mode" hint={stageMode === 'auto' ? 'Rolls up from modules (lowest wins)' : 'Project stage set independently of modules'}>
                  <select value={stageMode} onChange={(e) => setStageMode(e.target.value)} style={inputStyle}>
                    <option value="manual">Manual</option>
                    <option value="auto">Auto (rollup)</option>
                  </select>
                </Field>
              </Row>

              <Field label="Short description" hint="One line shown on the project card.">
                <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
              </Field>

              <Field label="Brief" hint="Longer context shown on the project detail page.">
                <textarea value={briefText} onChange={(e) => setBriefText(e.target.value)} style={textareaStyle} rows={4} />
              </Field>

              <Field label="Project link" hint="URL to the live project / repo / doc.">
                <input value={projectLink} onChange={(e) => setProjectLink(e.target.value)} style={inputStyle} placeholder="https://..." />
              </Field>

              <Field label="Endpoint" hint="Health-check URL for the project as a whole. Clearing this removes any stale issue flag on next save.">
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} style={inputStyle} placeholder="https://..." />
              </Field>

              <Row>
                <Field label="Monthly cost (AUD)">
                  <input type="number" min="0" step="0.01" value={monthlyCost} onChange={(e) => setMonthlyCost(e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Calls (MTD)">
                  <input type="number" min="0" step="1" value={callsThisMonth} onChange={(e) => setCallsThisMonth(e.target.value)} style={inputStyle} />
                </Field>
              </Row>

              <Field label="Feature wish list" hint="Each line is one item.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wishList.map((w, idx) => (
                    <div key={idx} style={wishItemStyle}>
                      <span style={{ flex: 1, fontSize: 13 }}>{w}</span>
                      <button onClick={() => removeWishItem(idx)} style={iconBtnStyle} aria-label="Remove">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={wishInput}
                      onChange={(e) => setWishInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWishItem(); } }}
                      placeholder="Add a wish list item and press Enter"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button onClick={addWishItem} style={addBtnStyle}>
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>
              </Field>
            </>
          )}

          {!isProject && (
            <>
              <Field label="Stage">
                <select value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle}>
                  {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>

              <Field label="Brief" hint="What this module does.">
                <textarea value={moduleBrief} onChange={(e) => setModuleBrief(e.target.value)} style={textareaStyle} rows={3} />
              </Field>

              <Field label="Endpoint" hint="Health-check URL. n8n / Make / generic HTTP all supported. Clearing this removes any stale issue flag on next save.">
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} style={inputStyle} placeholder="https://..." />
              </Field>
            </>
          )}

          {error && (
            <div style={errorBoxStyle}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          {/* Archive button — edit mode only */}
          {isEdit && !confirmingArchive && (
            <button onClick={() => setConfirmingArchive(true)} style={archiveBtnStyle} disabled={saving}>
              <Archive size={12} /> Archive
            </button>
          )}
          {isEdit && confirmingArchive && (
            <div style={confirmRowStyle}>
              <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>Archive this {kind}?</span>
              {isProject && <span style={{ fontSize: 11, color: TEXT_DIM }}>(modules will be archived too)</span>}
              <button onClick={handleArchive} style={confirmBtnStyle} disabled={saving}>
                {saving ? <Loader2 size={11} className="spin" /> : null} Yes, archive
              </button>
              <button onClick={() => setConfirmingArchive(false)} style={cancelConfirmBtnStyle} disabled={saving}>
                Cancel
              </button>
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={cancelBtnStyle} disabled={saving}>Cancel</button>
            <button onClick={handleSave} style={saveBtnStyle} disabled={saving || !name.trim()}>
              {saving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
              {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// RestoreButton — shown on archived items
// ============================================================
export function RestoreButton({ kind, id, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      if (kind === 'project') await restoreProject(id);
      else                    await restoreModule(id);
      await onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button onClick={go} disabled={busy} style={restoreBtnStyle}>
        {busy ? <Loader2 size={11} className="spin" /> : <RotateCcw size={11} />}
        Restore
      </button>
      {err && <span style={{ fontSize: 11, color: RED }}>{err}</span>}
    </div>
  );
}

// ============================================================
// Small layout helpers
// ============================================================
function Field({ label, hint, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={labelStyle}>
        {label}{required && <span style={{ color: YELLOW, marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}
function Row({ children }) {
  return <div className="modal-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

// ============================================================
// Styles
// ============================================================
const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: '40px 16px', zIndex: 100, overflowY: 'auto',
  fontFamily: '"Inter", -apple-system, sans-serif'
};
const modalStyle = {
  background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8,
  width: '100%', maxWidth: 560, position: 'relative', overflow: 'hidden',
  color: TEXT, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 80px)'
};
const accentBarStyle = {
  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
  background: `linear-gradient(90deg, transparent, ${YELLOW}, transparent)`
};
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: '22px 24px 16px', borderBottom: `1px solid ${BORDER}`
};
const kickerStyle = {
  fontSize: 10, color: YELLOW, textTransform: 'uppercase',
  letterSpacing: '0.14em', fontWeight: 700, marginBottom: 4
};
const titleStyle = { fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' };
const closeBtnStyle = {
  background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT_DIM,
  borderRadius: 4, width: 28, height: 28, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
};
const bodyStyle = {
  padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14,
  overflowY: 'auto', flex: 1
};
const footerStyle = {
  padding: '14px 24px', borderTop: `1px solid ${BORDER}`,
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'
};
const labelStyle = {
  fontSize: 11, fontWeight: 600, color: TEXT_DIM,
  textTransform: 'uppercase', letterSpacing: '0.08em'
};
const hintStyle = { fontSize: 11, color: TEXT_FAINT, marginTop: 2 };
const inputStyle = {
  background: BG, border: `1px solid ${BORDER}`, borderRadius: 4,
  padding: '8px 10px', color: TEXT, fontSize: 13, fontFamily: 'inherit',
  outline: 'none', width: '100%'
};
const textareaStyle = { ...inputStyle, resize: 'vertical', lineHeight: 1.5 };
const wishItemStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 8px 6px 11px', background: BG, border: `1px solid ${BORDER}`,
  borderRadius: 4
};
const iconBtnStyle = {
  background: 'transparent', border: 'none', color: TEXT_DIM,
  cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center'
};
const addBtnStyle = {
  background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT,
  borderRadius: 4, padding: '0 12px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit'
};
const saveBtnStyle = {
  background: YELLOW, color: BG, border: 'none', borderRadius: 4,
  padding: '8px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit'
};
const cancelBtnStyle = {
  background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT,
  borderRadius: 4, padding: '8px 14px', fontWeight: 600, fontSize: 12,
  cursor: 'pointer', fontFamily: 'inherit'
};
const archiveBtnStyle = {
  background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT_DIM,
  borderRadius: 4, padding: '8px 12px', fontWeight: 600, fontSize: 12,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit'
};
const confirmRowStyle = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
const confirmBtnStyle = {
  background: RED, color: TEXT, border: 'none', borderRadius: 4,
  padding: '7px 11px', fontWeight: 600, fontSize: 11, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit'
};
const cancelConfirmBtnStyle = {
  background: 'transparent', border: `1px solid ${BORDER}`, color: TEXT_DIM,
  borderRadius: 4, padding: '7px 11px', fontWeight: 600, fontSize: 11,
  cursor: 'pointer', fontFamily: 'inherit'
};
const restoreBtnStyle = {
  background: 'transparent', border: `1px solid ${YELLOW}`, color: YELLOW,
  borderRadius: 4, padding: '6px 10px', fontWeight: 600, fontSize: 11,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit'
};
const errorBoxStyle = {
  padding: '8px 11px', background: 'rgba(255,107,107,0.12)',
  border: `1px solid ${RED}`, borderRadius: 4, fontSize: 12, color: RED,
  display: 'flex', gap: 6, alignItems: 'flex-start'
};