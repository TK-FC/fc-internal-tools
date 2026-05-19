import { supabase } from './supabase';

// ============================================================
// SCHEMA ASSUMPTIONS (flag any mismatches when this first runs)
// ============================================================
// Table: items (see 01_schema.sql + 05_archive.sql)
//   ...all original columns...
//   archived (boolean, default false) — added in Session 6
//
// If any column name in the actual schema differs, fix it in mapProject /
// mapModule below — that's the only place column names appear.

function mapProject(row) {
  return {
    id: row.id,
    type: 'project',
    name: row.name,
    owner: row.owner,
    category: row.category,
    stage: row.stage,
    stageMode: row.stage_mode,
    description: row.description,
    projectLink: row.project_link,
    brief: row.brief,
    wishList: Array.isArray(row.wish_list) ? row.wish_list : [],
    monthlyCost: Number(row.monthly_cost ?? 0),
    callsThisMonth: row.calls_this_month ?? 0,
    archived: !!row.archived,
    sortOrder: row.sort_order ?? 0,
    modules: []
  };
}

function mapModule(row) {
  return {
    id: row.id,
    type: 'module',
    parentId: row.parent_id,
    name: row.name,
    stage: row.stage,
    healthStatus: row.health_status ?? 'none',
    endpoint: row.endpoint,
    lastHealthCheck: row.last_health_check,
    lastError: row.last_error,
    brief: row.module_brief,
    archived: !!row.archived,
    sortOrder: row.sort_order ?? 0,
    tasks: []
  };
}

/**
 * Fetch projects with modules nested.
 * @param {object} opts
 * @param {boolean} [opts.includeArchived=false] - if true, return archived rows too
 */
export async function fetchProjects({ includeArchived = false } = {}) {
  let q = supabase.from('items').select('*').order('sort_order', { ascending: true });
  if (!includeArchived) q = q.eq('archived', false);

  const { data, error } = await q;
  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  const projects = [];
  const modulesByParent = new Map();

  for (const row of data) {
    if (row.type === 'project') {
      projects.push(mapProject(row));
    } else if (row.type === 'module') {
      const m = mapModule(row);
      if (!modulesByParent.has(row.parent_id)) {
        modulesByParent.set(row.parent_id, []);
      }
      modulesByParent.get(row.parent_id).push(m);
    }
  }

  for (const project of projects) {
    project.modules = modulesByParent.get(project.id) || [];
  }

  return projects;
}