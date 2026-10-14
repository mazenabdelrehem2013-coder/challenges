// Default KPI templates (spec 7). Every template totals exactly 100%. HR can copy and edit
// them; a published template is versioned, never edited in place. Targets are left to each
// period's imported results (targetFromResult), because they differ by person and month.
const k = (kpiId, name, weight, direction, sourceType, extra = {}) => ({
  kpiId, name, weight, direction, sourceType, targetFromResult: true, required: true, ...extra,
});

// Survey and audit scores are already 0-100 against a target score; manager assessments
// are rated on a 1-5 scale with bands.
const ASSESSMENT = {
  direction: 'threshold',
  sourceType: 'manager_assessment',
  scoringRule: { better: 'higher', bands: [{ atLeast: 5, score: 100 }, { atLeast: 4, score: 85 }, { atLeast: 3, score: 70 }, { atLeast: 2, score: 40 }, { atLeast: 0, score: 0 }] },
};
const assessed = (kpiId, name, weight) => ({ kpiId, name, weight, required: true, ...ASSESSMENT });

export const DEFAULT_TEMPLATES = [
  {
    id: 'sales', name: 'Sales and Business Development', version: 1, status: 'published', effectiveFrom: '2026-01',
    kpis: [
      k('revenue', 'Revenue achievement', 30, 'higher', 'import'),
      k('collections', 'Collections performance', 20, 'higher', 'import'),
      k('dealer_coverage', 'Dealer coverage and growth', 20, 'higher', 'import'),
      k('sales_returns', 'Sales quality and returns (return rate %)', 15, 'lower', 'import'),
      assessed('teamwork', 'Teamwork', 15),
    ],
  },
  {
    id: 'customer_service', name: 'Customer Service', version: 1, status: 'published', effectiveFrom: '2026-01',
    kpis: [
      k('csat', 'Customer satisfaction', 30, 'higher', 'survey'),
      k('fcr', 'First-contact resolution', 25, 'higher', 'import'),
      k('sla', 'Service-level agreement performance', 20, 'higher', 'import'),
      k('quality_audit', 'Quality audit', 15, 'higher', 'manual_verified'),
      k('learning_teamwork', 'Learning and teamwork', 10, 'higher', 'lms'),
    ],
  },
  {
    id: 'logistics', name: 'Logistics and Warehouse', version: 1, status: 'published', effectiveFrom: '2026-01',
    kpis: [
      k('on_time_delivery', 'On-time delivery', 30, 'higher', 'import'),
      k('inventory_accuracy', 'Inventory accuracy', 25, 'higher', 'import'),
      k('order_accuracy', 'Order accuracy', 20, 'higher', 'import'),
      {
        kpiId: 'safety_incidents', name: 'Safety and compliance (incidents)', weight: 15, direction: 'lower', sourceType: 'import',
        target: 0, required: true, scoringRule: { zeroTarget: { mode: 'decay', pointsPerUnit: 50 } },
      },
      assessed('teamwork', 'Teamwork', 10),
    ],
  },
  {
    id: 'maintenance', name: 'Maintenance and After-Sales', version: 1, status: 'published', effectiveFrom: '2026-01',
    kpis: [
      k('resolution_sla', 'Resolution within SLA', 30, 'higher', 'import'),
      k('first_time_fix', 'First-time fix rate', 25, 'higher', 'import'),
      k('csat', 'Customer satisfaction', 20, 'higher', 'survey'),
      k('repeat_repair', 'Repeat repair rate', 15, 'lower', 'import'),
      k('documentation', 'Documentation quality', 10, 'higher', 'manual_verified'),
    ],
  },
  {
    id: 'hr', name: 'Human Resources', version: 1, status: 'published', effectiveFrom: '2026-01',
    kpis: [
      k('hiring_sla', 'Hiring SLA', 25, 'higher', 'import'),
      k('employee_service', 'Employee service', 20, 'higher', 'survey'),
      k('training_completion', 'Training completion', 20, 'higher', 'lms'),
      k('data_accuracy', 'Data accuracy', 20, 'higher', 'manual_verified'),
      k('engagement', 'Engagement initiatives', 15, 'higher', 'manual_verified'),
    ],
  },
  {
    id: 'finance', name: 'Finance', version: 1, status: 'published', effectiveFrom: '2026-01',
    kpis: [
      k('reporting_accuracy', 'Reporting accuracy', 30, 'higher', 'manual_verified'),
      k('closing_timeliness', 'Closing timeliness', 25, 'higher', 'import'),
      k('reconciliation', 'Reconciliation', 20, 'higher', 'import'),
      k('compliance', 'Compliance', 15, 'higher', 'manual_verified'),
      k('internal_service', 'Internal service', 10, 'higher', 'survey'),
    ],
  },
  {
    id: 'it', name: 'IT', version: 1, status: 'published', effectiveFrom: '2026-01',
    kpis: [
      k('uptime', 'Service uptime', 25, 'higher', 'import'),
      k('incident_resolution', 'Incident resolution', 25, 'higher', 'import'),
      k('sla', 'SLA compliance', 20, 'higher', 'import'),
      k('security', 'Security and compliance', 20, 'higher', 'manual_verified'),
      k('documentation', 'Documentation', 10, 'higher', 'manual_verified'),
    ],
  },
];

export const DEFAULT_CHALLENGE_LIBRARY = [
  { id: 'product_quiz', title: 'Complete a product knowledge quiz', maxCredits: 10, category: 'learning', verificationType: 'quiz' },
  { id: 'required_training', title: 'Complete required training', maxCredits: 15, category: 'learning', verificationType: 'lms' },
  { id: 'difficult_case', title: 'Resolve a difficult customer case', maxCredits: 20, category: 'customer', verificationType: 'manager_review' },
  { id: 'on_time_target', title: 'Achieve an on-time delivery target', maxCredits: 20, category: 'operations', verificationType: 'import' },
  { id: 'process_improvement', title: 'Submit an approved process improvement', maxCredits: 15, category: 'innovation', verificationType: 'manager_review' },
  { id: 'cross_department', title: 'Complete a cross-department project', maxCredits: 25, category: 'teamwork', verificationType: 'manager_review' },
  { id: 'error_free', title: 'Maintain an error-free process', maxCredits: 15, category: 'quality', verificationType: 'import' },
];

export const DEFAULT_BADGES = [
  { id: 'target_achiever', name: 'Target Achiever', criteriaVersion: 1, criteria: { kind: 'kpi_score_at_least', value: 100 } },
  { id: 'team_champion', name: 'Team Champion', criteriaVersion: 1, criteria: { kind: 'team_rank', value: 1 } },
  { id: 'learning_expert', name: 'Learning Expert', criteriaVersion: 1, criteria: { kind: 'learning_challenges', value: 3 } },
  { id: 'innovator', name: 'Innovator', criteriaVersion: 1, criteria: { kind: 'approved_improvements', value: 1 } },
  { id: 'customer_champion', name: 'Customer Champion', criteriaVersion: 1, criteria: { kind: 'hr_award', value: 'customer_champion' } },
  { id: 'quality_champion', name: 'Quality Champion', criteriaVersion: 1, criteria: { kind: 'error_free_months', value: 3 } },
  { id: 'most_improved', name: 'Most Improved Employee', criteriaVersion: 1, criteria: { kind: 'score_gain_at_least', value: 10 } },
];
