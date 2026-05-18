import { supabase } from './supabase';

// ============================================================
// SCHEMA ASSUMPTIONS (flag any mismatches when this first runs)
// ============================================================
// Table: items
//   id (uuid PK)
//   parent_id (uuid, null = project, set = module's parent project)
//   type ('project' | 'module')
//   name (text)
//   owner (text, project only)
//   category (text, project only)
//   stage (text: ideation | building | finalisation | released)
//   stage_mode (text, project only: 'auto' | 'manual')
//   description (text, project only)
//   project_link (text, project only)
//   brief (text, project only)
//   module_brief (text, module only)
//   monthly_cost (numeric, project only)
//   calls_this_month (int, project only)
//   endpoint (text, module only)
//   health_status (text: green | amber | red | none)
//   last_health_check (timestamptz)
//   last_error (text)
//   sort_order (int)
//
// If any column name in the actual schema differs, fix it in mapProject /
// mapModule below — that's the only place column names appear.

// Snake_case row → camelCase project (UI shape)
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
    monthlyCost: Number(row.monthly_cost ?? 0),
    callsThisMonth: row.calls_this_month ?? 0,
    // wishList + modules populated by caller after grouping
    wishList: [],
    modules: []
  };
}

// Snake_case row → camelCase module. Note: module_brief lands on `brief`
// so the UI's existing ModuleDetail code keeps working unchanged.
function mapModule(row) {
  return {
    id: row.id,
    type: 'module',
    name: row.name,
    stage: row.stage,
    healthStatus: row.health_status ?? 'none',
    endpoint: row.endpoint,
    lastHealthCheck: row.last_health_check,
    lastError: row.last_error,
    brief: row.module_brief,
    tasks: [] // Wired in Session 6
  };
}

/**
 * Fetch all projects with their modules nested.
 * Returns array shaped exactly like the old MOCK_PROJECTS so the rest of
 * the UI doesn't need to change.
 */
export async function fetchProjects() {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Split into projects + modules
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

  // Attach modules to their parent project (already sorted by sort_order
  // from the query, so no need to re-sort)
  for (const project of projects) {
    project.modules = modulesByParent.get(project.id) || [];
  }

  return projects;
}