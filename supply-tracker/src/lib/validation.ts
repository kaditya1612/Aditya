import { z } from "zod";

const optionalText = z.string().trim().max(5000).optional().or(z.literal("")).transform((v) => v || null);
const uuid = z.string().uuid({ message: "Required" });

export const taskSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  description: optionalText,
  category_id: uuid,
  requirement_type: z.enum(["urgent", "ad_hoc", "standard"]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  owner_id: uuid,
  contributor_ids: z.array(z.string().uuid()).default([]),
  start_date: z.string().optional().or(z.literal("")).transform((v) => v || null),
  due_at: z.string().min(1, "Due date is required"),
  estimated_hours: z.coerce.number().min(0).max(999).optional().or(z.nan().transform(() => undefined)),
  destination: optionalText,
  vendor_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
}).refine((v) => !v.start_date || !v.due_at || new Date(v.due_at) >= new Date(v.start_date), {
  message: "Due date must be after the start date", path: ["due_at"],
});

export const employeeSchema = z.object({
  employee_code: z.string().trim().min(2, "Employee ID is required").max(30).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  full_name: z.string().trim().min(2, "Name is required").max(120),
  email: z.string().trim().email("Invalid email").optional().or(z.literal("")).transform((v) => v || null),
  phone: optionalText,
  designation: z.string().trim().min(2, "Designation is required").max(120),
  team_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  reporting_manager_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  joining_date: z.string().optional().or(z.literal("")).transform((v) => v || null),
  employment_status: z.enum(["active", "on_leave", "inactive"]),
  daily_capacity_hours: z.coerce.number().min(1).max(24),
  notes: optionalText,
});

export const requirementSchema = z.object({
  department_id: uuid,
  requested_by_name: z.string().trim().min(2, "Who raised it?").max(120),
  description: z.string().trim().min(5, "Describe the requirement").max(5000),
  destination: optionalText,
  product_name: optionalText,
  requirement_type: z.enum(["urgent", "ad_hoc", "standard"]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  raised_at: z.string().optional().or(z.literal("")).transform((v) => v || null),
  required_by: z.string().optional().or(z.literal("")).transform((v) => v || null),
});

const money = z.union([z.literal(""), z.coerce.number().min(0).max(1e10)]).transform((v) => (v === "" ? null : v));
export const costingSchema = z.object({
  tour_code: z.string().trim().min(1, "Tour ID is required").max(60),
  tour_name: z.string().trim().min(2, "Tour name is required").max(200),
  destination: optionalText,
  vendor_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  supplier_name: optionalText,
  activity_type: z.enum(["new_costing", "cost_revision", "price_discrepancy", "pax_vs_car_validation",
    "private_vs_sic_validation", "seasonal_pricing", "selling_price_validation", "margin_impact"]),
  existing_cost: money,
  updated_cost: money,
  currency: z.string().trim().length(3, "3-letter code").transform((v) => v.toUpperCase()),
  costing_basis: z.enum(["per_person", "per_car", "per_group"]),
  transfer_type: z.enum(["private", "sic", ""]).transform((v) => v || null),
  season: optionalText,
  selling_price: money,
  effective_date: z.string().optional().or(z.literal("")).transform((v) => v || null),
  assigned_employee_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  remarks: optionalText,
  confirmation_reference: optionalText,
});

export const vendorSchema = z.object({
  vendor_code: optionalText,
  name: z.string().trim().min(2, "Name is required").max(200),
  vendor_type: z.enum(["DMC", "Supplier", "Transfer", "Hotel", "Activity", "Other"]),
  destination: optionalText,
  country: optionalText,
  contact_name: optionalText,
  contact_email: z.string().trim().email("Invalid email").optional().or(z.literal("")).transform((v) => v || null),
  contact_phone: optionalText,
  performance_rating: z.union([z.literal(""), z.coerce.number().int().min(1).max(5)]).transform((v) => (v === "" ? null : v)),
  is_active: z.boolean(),
  notes: optionalText,
});

export const newUserSchema = z.object({
  email: z.string().trim().email(),
  full_name: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "manager", "leader"]),
  team_id: z.string().uuid().nullable().optional(),
  password: z.string().min(10, "Use at least 10 characters").max(72),
});

/** First validation error per field, for inline form messages */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const k = issue.path.join(".");
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}
