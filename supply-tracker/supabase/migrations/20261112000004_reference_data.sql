-- =====================================================================
-- Reference data (configuration, not dummy business data)
-- =====================================================================
insert into public.task_category_groups(code, name, sort_order) values
  ('A', 'Product Management', 1),
  ('B', 'Costing & Pricing', 2),
  ('C', 'Vendor & DMC Management', 3),
  ('D', 'Internal Coordination', 4),
  ('E', 'Research & Analysis', 5),
  ('F', 'Reporting & Documentation', 6);

insert into public.task_categories(group_id, name, sort_order, default_effort_hours)
select g.id, c.name, c.ord, c.hours
from (values
  ('A', 'New Product Research', 1, 4), ('A', 'Product Mapping', 2, 2), ('A', 'Activity Validation', 3, 2),
  ('A', 'Product Description', 4, 1.5), ('A', 'Inclusions and Exclusions', 5, 1), ('A', 'Database Updates', 6, 1),
  ('A', 'Product Sheet Verification', 7, 1), ('A', 'New Destination Research', 8, 6),
  ('B', 'New Product Costing', 1, 3), ('B', 'Existing Product Cost Revision', 2, 2), ('B', 'Cost Validation', 3, 1.5),
  ('B', 'Supplier Rate Comparison', 4, 2), ('B', 'Selling Price Validation', 5, 1), ('B', 'Margin Analysis', 6, 2),
  ('B', 'Costing Discrepancy', 7, 1.5), ('B', 'Peak Season Costing', 8, 3), ('B', 'Contract Rate Updates', 9, 2),
  ('C', 'New DMC Research', 1, 4), ('C', 'Supplier Follow-up', 2, 0.5), ('C', 'Rate Negotiation', 3, 2),
  ('C', 'Contract Validation', 4, 2), ('C', 'Supplier Confirmation', 5, 0.5), ('C', 'Costing Clarification', 6, 1),
  ('C', 'Supplier Performance Review', 7, 2),
  ('D', 'Sales Requirements', 1, 1.5), ('D', 'Operations Requirements', 2, 1.5), ('D', 'Product Team Requirements', 3, 1.5),
  ('D', 'Management Requirements', 4, 2), ('D', 'Internal Meetings', 5, 1), ('D', 'Pending Clarifications', 6, 0.5),
  ('E', 'Destination Research', 1, 4), ('E', 'Competitor Price Analysis', 2, 3), ('E', 'Market Research', 3, 4),
  ('E', 'Ticket Price Research', 4, 1.5), ('E', 'Transfer Feasibility', 5, 1.5), ('E', 'Activity Research', 6, 2),
  ('F', 'Daily Reports', 1, 0.5), ('F', 'Weekly Reports', 2, 1.5), ('F', 'Monthly Reports', 3, 3),
  ('F', 'Product Sheets', 4, 2), ('F', 'Costing Reports', 5, 2), ('F', 'Performance Reports', 6, 2),
  ('F', 'SOP Documentation', 7, 3)
) as c(code, name, ord, hours)
join public.task_category_groups g on g.code = c.code;

insert into public.requesting_departments(name) values
  ('Sales'), ('Operations'), ('Management'), ('Product'), ('Supply (internal)');

insert into public.teams(name, description) values ('Supply Team', 'Core Supply Team');

insert into public.app_settings(key, value, description) values
  ('timezone', '"Asia/Kolkata"', 'Business timezone used for "due today" and daily reports'),
  ('workload_thresholds', '{"low": 0.5, "moderate": 0.85, "high": 1.1}',
     'Workload ratio = open estimated hours due within the horizon ÷ capacity. Below low = Low; below moderate = Moderate; below high = High; otherwise Overloaded'),
  ('workload_horizon_days', '3', 'Days ahead counted in the workload indicator (overdue work always counts)'),
  ('default_task_hours', '2', 'Effort assumed for tasks with no estimate'),
  ('priority_weights', '{"critical": 4, "high": 3, "medium": 2, "low": 1}', 'Weights used in the productivity score'),
  ('late_completion_factor', '0.7', 'Multiplier applied to tasks completed after their deadline'),
  ('reopen_penalty', '0.15', 'Score fraction deducted per reopened task'),
  ('requirement_delay_days', '{"urgent": 1, "ad_hoc": 2, "standard": 5}', 'Days pending after which a requirement is flagged as slow');
