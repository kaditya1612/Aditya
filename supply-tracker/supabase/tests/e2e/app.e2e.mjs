// End-to-end browser test of the real Next.js app against the local emulator.
// Usage: BASE=http://localhost:3100 SHOTS=/path node supabase/tests/e2e/app.e2e.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp/e2e-shots";
fs.mkdirSync(SHOTS, { recursive: true });
const PW = "Passw0rd!123";
let passed = 0;
const ok = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); passed++; console.log("  ✓ " + msg); };

const browser = await chromium.launch();
async function session(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
async function toast(page, re) { await page.getByText(re).first().waitFor({ timeout: 10000 }); }
const lbl = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}( \\*)?$`);
async function selectByLabel(page, label, optionText, scope) {
  const sel = (scope ?? page).getByLabel(lbl(label));
  const value = await sel.evaluate((el, t) => [...el.options].find((o) => o.text.includes(t))?.value, optionText);
  if (!value) throw new Error(`option "${optionText}" not found for ${label}`);
  await sel.selectOption(value);
}

try {
  // ------------------------------------------------------------------ auth
  console.log("Authentication & access");
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/tasks`);
    ok(page.url().includes("/login"), "unauthenticated visitor is redirected to login");
    await page.getByLabel("Work email").fill("manager@supply.test");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Incorrect email or password").waitFor();
    ok(true, "wrong password is rejected");
    await ctx.close();
  }

  const M = await session("manager@supply.test");
  const m = M.page;
  await m.getByText("Total Tasks").waitFor();
  ok(await m.getByRole("heading", { name: "Welcome, Priya" }).isVisible(), "manager signs in and sees dashboard");
  await shot(m, "01-dashboard-empty");

  // ------------------------------------------------------------- employees
  console.log("Employee management");
  await m.goto(`${BASE}/employees`);
  const employees = [
    ["SUP-101", "Asha Rao", "Senior Supply Executive", "Supply Team"],
    ["SUP-102", "Ben Thomas", "Costing Analyst", "Supply Team"],
    ["SUP-201", "Chen Li", "Destination Specialist", "Destinations Team"],
  ];
  for (const [code, name, desig, team] of employees) {
    await m.getByRole("button", { name: "Add employee" }).click();
    const dlg = m.getByRole("dialog");
    await dlg.getByLabel("Employee name").fill(name);
    await dlg.getByLabel("Employee ID").fill(code);
    await dlg.getByLabel("Designation").fill(desig);
    await selectByLabel(m, "Team", team, dlg);
    await selectByLabel(m, "Reporting manager / leader", team === "Supply Team" ? "Leo Leader" : "Lia Leader", dlg);
    await dlg.getByLabel("Joining date").fill("2024-04-01");
    await dlg.getByRole("button", { name: "Save" }).click();
    await toast(m, /added to the Supply Team directory/);
    await dlg.waitFor({ state: "detached" });
  }
  await m.getByRole("link", { name: "Chen Li" }).waitFor();
  ok(await m.getByRole("link", { name: "Ben Thomas" }).isVisible(), "manager adds employees to the directory");
  // validation
  await m.getByRole("button", { name: "Add employee" }).click();
  await m.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  ok(await m.getByText("Employee ID is required").isVisible(), "employee form validates required fields");
  await m.keyboard.press("Escape");
  await shot(m, "02-employees");

  // ----------------------------------------------------------------- tasks
  console.log("Task creation & assignment");
  await m.goto(`${BASE}/tasks`);
  await m.getByRole("button", { name: "New task" }).click();
  let dlg = m.getByRole("dialog");
  await dlg.getByLabel("Task title").fill("Peak season costing — Bali private transfers");
  await dlg.getByLabel("Detailed description").fill("Revise per-car costs for Dec–Jan with the new DMC rate sheet.");
  await selectByLabel(m, "Task category", "Peak Season Costing", dlg);
  await dlg.getByLabel(lbl("Priority")).selectOption("critical");
  await dlg.getByLabel("Requirement type").selectOption("urgent");
  await selectByLabel(m, "Accountable owner", "Ben Thomas", dlg);
  const contrib = await dlg.getByLabel("Additional team members").evaluate((el) => [...el.options].find((o) => o.text === "Asha Rao").value);
  await dlg.getByLabel("Additional team members").selectOption([contrib]);
  await dlg.getByRole("button", { name: "Create task" }).click();
  await m.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  const taskUrl = m.url();
  await m.getByRole("heading", { name: /Peak season costing/ }).waitFor();
  ok(await m.getByText(/TSK-\d{6}/).first().isVisible(), "task created with auto-generated ID");
  ok(await m.getByText("Asha Rao").first().isVisible(), "multiple team members with one accountable owner");
  await m.reload();
  await m.getByRole("heading", { name: /Peak season costing/ }).waitFor();
  ok(await m.getByRole("link", { name: "Ben Thomas" }).isVisible(), "task persists after refresh with the correct owner");
  await shot(m, "03-task-detail");

  // ----------------------------------------------------- workflow on the task
  console.log("Status workflow, comments, approvals");
  await m.getByRole("button", { name: "Change status" }).click();
  dlg = m.getByRole("dialog");
  await dlg.getByLabel("New status").selectOption("in_progress");
  await dlg.getByLabel("Remarks").fill("Started with DMC rate sheet");
  await dlg.getByRole("button", { name: "Update" }).click();
  await toast(m, /→ In Progress/);
  await m.getByText("Started with DMC rate sheet").first().waitFor();
  ok(true, "status change recorded in history with remarks");

  await m.getByLabel("Add a remark").fill("x").catch(() => {});
  await m.locator("main select").first().selectOption("supplier_response");
  await m.getByPlaceholder(/Add a remark/).fill("DMC confirmed 8% increase for peak dates");
  await m.getByRole("button", { name: "Post" }).click();
  await m.getByText("DMC confirmed 8% increase").waitFor();
  ok(true, "supplier response logged in activity");

  await m.getByRole("button", { name: "Submit for review" }).click();
  dlg = m.getByRole("dialog");
  await dlg.getByLabel("Actual time spent (hours)").fill("3.5");
  await dlg.getByLabel("Completion remarks").fill("All 12 transfer rows revised");
  await dlg.getByRole("button", { name: "Update" }).click();
  await toast(m, /→ Awaiting Review/);
  await m.getByRole("button", { name: /Review & approve/ }).click();
  dlg = m.getByRole("dialog");
  await dlg.getByRole("button", { name: /Reject & reopen/ }).click();
  ok(await dlg.getByText("Give a reason").isVisible(), "rejecting a completion requires a reason");
  await dlg.getByLabel("Review remarks").fill("Child rates missing");
  await dlg.getByRole("button", { name: /Reject & reopen/ }).click();
  await toast(m, /sent back/);
  await m.getByText("1×", { exact: true }).waitFor();
  ok(await m.locator("main").getByText("Reopened", { exact: true }).first().isVisible(), "rejected task is reopened and reopen counted");

  await m.getByRole("button", { name: "Submit for review" }).click();
  dlg = m.getByRole("dialog");
  await dlg.getByLabel("Completion remarks").fill("Child rates added");
  await dlg.getByRole("button", { name: "Update" }).click();
  await toast(m, /→ Awaiting Review/);
  await m.getByRole("button", { name: /Review & approve/ }).click();
  dlg = m.getByRole("dialog");
  await dlg.getByRole("button", { name: "4 stars" }).click();
  await dlg.getByRole("button", { name: /Approve & close/ }).click();
  await toast(m, /approved and closed/);
  await m.getByText("★★★★☆").waitFor();
  ok(true, "manager approves completion with a quality rating; task closed");
  await shot(m, "04-task-approved");


  // ---------------------------------------------------------- requirements
  console.log("Supply Requirement Tracker");
  await m.goto(`${BASE}/requirements`);
  await m.getByRole("button", { name: "New requirement" }).click();
  dlg = m.getByRole("dialog");
  await selectByLabel(m, "Requesting department", "Sales", dlg);
  await dlg.getByLabel(lbl("Requested by")).fill("Rohan (Sales)");
  await dlg.getByLabel(lbl("Requirement description")).fill("Private desert safari costing for a family of 6, Dubai, 20 Dec");
  await dlg.getByLabel("Destination").fill("Dubai");
  await dlg.getByLabel("Product / Activity name").fill("Desert Safari");
  await dlg.getByLabel(lbl("Requirement type")).selectOption("urgent");
  await dlg.getByLabel(lbl("Priority")).selectOption("high");
  await dlg.getByLabel("Required completion date").fill(new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10));
  await dlg.getByRole("button", { name: "Record requirement" }).click();
  await toast(m, /Requirement recorded/);
  await m.getByText(/REQ-\d{6}/).first().click();
  const drawer = m.locator("aside").last();
  await drawer.getByRole("button", { name: "Reject" }).click();
  ok(await drawer.getByRole("button", { name: /Confirm: Reject/ }).isDisabled(), "rejection is blocked until a reason is entered");
  await drawer.getByRole("button", { name: "Cancel" }).click();
  await drawer.getByRole("button", { name: "Accept" }).click();
  await drawer.getByRole("button", { name: /Confirm: Accept/ }).click();
  await toast(m, /→ Accepted/);
  await drawer.getByRole("button", { name: "Assign owner" }).click();
  dlg = m.getByRole("dialog");
  ok(await dlg.getByRole("button", { name: "Assign" }).isDisabled(), "requirement cannot be assigned without an owner");
  await selectByLabel(m, "Supply Team member (owner)", "Asha Rao", dlg);
  await selectByLabel(m, "Task category for the linked task", "Sales Requirements", dlg);
  await dlg.getByRole("button", { name: "Assign" }).click();
  await toast(m, /linked task created/);
  await drawer.getByText(/Linked task:/).waitFor();
  ok(await drawer.getByText("Assigned", { exact: true }).first().isVisible(), "accepted requirement assigned; linked task created");
  ok(await drawer.getByText(/recorded as/).isVisible() && await drawer.getByText(/Accepted → /).isVisible(), "requirement status history recorded");
  await shot(m, "05-requirement");
  const reqTaskHref = await drawer.getByRole("link", { name: /TSK-/ }).getAttribute("href");

  // -------------------------------------------------------------- costing
  console.log("Costing & validation");
  await m.goto(`${BASE}/costing`);
  await m.getByRole("button", { name: "New costing" }).click();
  dlg = m.getByRole("dialog");
  await dlg.getByLabel(lbl("Tour ID")).fill("DXB-SAF-01");
  await dlg.getByLabel(lbl("Tour name")).fill("Desert Safari — Private 4x4");
  await dlg.getByLabel("Destination").fill("Dubai");
  await dlg.getByLabel("…or supplier name").fill("Arabian Nights DMC");
  await dlg.getByLabel(lbl("Validation activity")).selectOption("cost_revision");
  await dlg.getByLabel(lbl("Costing basis")).selectOption("per_car");
  await dlg.getByLabel("Transfer type").selectOption("private");
  await dlg.getByLabel(lbl("Currency")).fill("AED");
  await dlg.getByLabel("Existing database cost").fill("400");
  await dlg.getByLabel("Updated supplier cost").fill("450");
  await dlg.getByLabel("Selling price").fill("600");
  ok(await dlg.getByText("(25.0%)").isVisible(), "margin calculated live in the form");
  await selectByLabel(m, "Assigned employee", "Ben Thomas", dlg);
  await dlg.getByRole("button", { name: "Create" }).click();
  await toast(m, /Costing record created/);
  const cdrawer = m.locator("aside").last();
  await cdrawer.getByRole("button", { name: "Submit for approval" }).click();
  await m.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await toast(m, /→ Pending Approval/);
  ok(await cdrawer.getByRole("button", { name: "Approve" }).isDisabled(), "costing approval disabled without confirmation reference");
  await cdrawer.getByLabel(lbl("Supplier confirmation reference")).fill("Email ARB/2026/118");
  await cdrawer.getByRole("button", { name: "Approve" }).click();
  await m.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await toast(m, /approved and locked/);
  await cdrawer.getByRole("button", { name: "Create revision" }).waitFor();
  ok(!(await cdrawer.getByRole("button", { name: "Edit figures" }).count()), "approved costing is locked (no edit)");
  ok(await cdrawer.getByText(/updated cost/i).first().isVisible() || await cdrawer.getByText(/status → approved/).isVisible(), "costing change history shown");
  await cdrawer.locator('input[type="file"]').setInputFiles({ name: "arabian-nights-rate-sheet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await cdrawer.getByText("arabian-nights-rate-sheet.pdf").waitFor();
  ok(true, "supporting document uploaded to private storage and listed");
  await shot(m, "06-costing");

  // ---------------------------------------------------- leader restrictions
  console.log("Team Leader scope");
  const L = await session("leader@supply.test");
  const l = L.page;
  await l.goto(`${BASE}/employees`);
  await l.getByRole("link", { name: "Asha Rao" }).waitFor();
  ok(!(await l.getByRole("link", { name: "Chen Li" }).count()), "leader only sees own team members");
  ok(!(await l.getByRole("button", { name: "Add employee" }).count()), "leader cannot add employees");
  ok(!(await l.getByRole("link", { name: "Audit History" }).count()), "audit history hidden from leaders");
  await l.goto(`${BASE}/tasks`);
  await l.getByRole("button", { name: "New task" }).click();
  dlg = l.getByRole("dialog");
  ok(!(await dlg.getByLabel(lbl("Accountable owner")).locator("option", { hasText: "Chen Li" }).count()), "leader cannot assign outside own team");
  await dlg.getByLabel(lbl("Task title")).fill("Map new Bali ATV activity");
  await selectByLabel(l, "Task category", "Product Mapping", dlg);
  await selectByLabel(l, "Accountable owner", "Asha Rao", dlg);
  await dlg.getByLabel(lbl("Estimated effort (hours)")).fill("2");
  await dlg.getByRole("button", { name: "Create task" }).click();
  await l.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  const leaderTaskUrl = l.url();
  await l.getByRole("button", { name: "Request extension" }).click();
  dlg = l.getByRole("dialog");
  const later = new Date(Date.now() + 5 * 864e5); later.setHours(18, 0, 0, 0);
  const local = new Date(later.getTime() - later.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await dlg.getByLabel(lbl("Proposed deadline")).fill(local);
  await dlg.getByLabel(lbl("Reason for delay")).fill("Supplier has not shared the ATV route map");
  await dlg.getByRole("button", { name: "Submit request" }).click();
  await toast(l, /awaiting manager approval/);
  await l.getByText("Extension requested", { exact: true }).waitFor();
  ok(!(await l.getByRole("button", { name: "Approve" }).count()), "leader's extension waits for manager; deadline unchanged");
  await l.getByRole("button", { name: "Submit for review" }).click();
  dlg = l.getByRole("dialog");
  await dlg.getByRole("button", { name: "Update" }).click();
  await toast(l, /Awaiting Review/);
  ok(!(await l.getByRole("button", { name: /Review & approve/ }).count()), "leader cannot approve completion");
  const L2 = await session("leader2@supply.test");
  await L2.page.goto(leaderTaskUrl);
  await L2.page.getByText(/outside your authorised scope/).waitFor();
  ok(true, "leader of another team cannot open the task");
  await L2.ctx.close();

  // ------------------------------------------- manager approves the extension
  console.log("Deadline extension approval & notifications");
  await m.goto(`${BASE}/dashboard`);
  await m.getByText("Extension requests").waitFor();
  await m.getByRole("button", { name: /Notifications \(\d+ unread\)/ }).click();
  await m.getByText(/Deadline extension requested/).first().waitFor();
  ok(true, "manager notified in-app of the extension request");
  await m.getByText(/Deadline extension requested/).first().click();
  await m.waitForURL(/\/tasks\//);
  await m.getByRole("button", { name: "Approve", exact: true }).click();
  await m.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await toast(m, /deadline revised/);
  await m.getByText("ext ×1").first().waitFor();
  ok(await m.getByText("Supplier has not shared the ATV route map").first().isVisible(), "approved extension revises deadline, keeps reason and original deadline");

  // ---------------------------------------------------------------- kanban
  console.log("Kanban drag & drop");
  await m.goto(reqTaskHref.startsWith("http") ? reqTaskHref : `${BASE}${reqTaskHref}`);
  const reqTaskCode = (await m.getByText(/^TSK-\d{6}$/).first().textContent()).trim();
  await m.goto(`${BASE}/kanban`);
  const card = m.getByRole("link", { name: reqTaskCode }).locator("xpath=ancestor::div[contains(@class,'cursor-grab')]");
  await card.waitFor();
  const target = m.getByRole("heading", { name: "In Progress", exact: true }).locator("xpath=../..");
  const cb = await card.boundingBox(); const tb = await target.boundingBox();
  await m.mouse.move(cb.x + cb.width / 2, cb.y + 20);
  await m.mouse.down();
  await m.mouse.move(cb.x + cb.width / 2 + 20, cb.y + 30, { steps: 5 });
  await m.mouse.move(tb.x + tb.width / 2, tb.y + 80, { steps: 15 });
  await m.mouse.up();
  await toast(m, new RegExp(`${reqTaskCode} → In Progress`));
  ok(true, "dragging a card updates the status through the workflow");
  await shot(m, "07-kanban");
  await m.goto(`${BASE}/requirements`);
  await m.getByText("In Progress", { exact: true }).first().waitFor();
  ok(true, "requirement followed its task into In Progress");

  // ------------------------------------------------------------ allocation
  console.log("Daily allocation");
  await m.goto(`${BASE}/allocation`);
  await m.getByRole("link", { name: /Asha Rao/ }).first().waitFor();
  ok(await m.getByText(/Workload/).first().isVisible(), "workload indicator displayed per employee");
  await shot(m, "08-allocation");

  // ------------------------------------------------- dashboard & drill-down
  console.log("Dashboard");
  await m.goto(`${BASE}/dashboard`);
  const total = m.getByRole("button", { name: /Total Tasks/ });
  await total.waitFor();
  const n = Number((await total.locator("p").nth(1).textContent()).trim());
  ok(n === 3, `KPI total computed from database (${n})`);
  await m.getByRole("button", { name: /Completed/ }).first().click();
  await m.getByRole("link", { name: /Peak season costing/ }).first().waitFor();
  ok(true, "KPI drill-down lists the underlying task records");
  await m.keyboard.press("Escape");
  await m.waitForTimeout(800);
  await shot(m, "09-dashboard");

  // --------------------------------------------------------------- reports
  console.log("Reports & exports");
  await m.goto(`${BASE}/reports`);
  await m.getByRole("button", { name: /Task Completion Report/ }).click();
  await m.getByText("Peak season costing — Bali private transfers").waitFor();
  for (const [btn, ext] of [["CSV", ".csv"], ["Excel", ".xlsx"], ["PDF", ".pdf"]]) {
    const [dl] = await Promise.all([m.waitForEvent("download"), m.getByRole("button", { name: btn, exact: true }).click()]);
    const file = `${SHOTS}/report${ext}`;
    await dl.saveAs(file);
    ok(dl.suggestedFilename().endsWith(ext) && fs.statSync(file).size > 300, `report exported as ${ext} (${fs.statSync(file).size} bytes)`);
  }
  ok(fs.readFileSync(`${SHOTS}/report.csv`, "utf8").includes("Peak season costing"), "CSV export contains real database rows");
  await m.getByRole("button", { name: /Deadline Extension Report/ }).click();
  await m.getByText("Supplier has not shared the ATV route map").waitFor();
  ok(true, "deadline extension report lists the extension");

  // ----------------------------------------------------------------- audit
  console.log("Audit");
  await m.goto(`${BASE}/audit`);
  for (const a of ["task.created", "task.approved", "task.rejected", "task.deadline_changed", "costing.approved", "requirement.accepted", "employee.created"]) {
    await m.getByText(a, { exact: true }).first().waitFor();
  }
  ok(true, "audit trail shows creation, approval, rejection, deadline, costing and requirement actions");
  await shot(m, "10-audit");

  // ---------------------------------------------------------- dark & mobile
  console.log("Dark mode & mobile");
  await m.getByRole("button", { name: "Toggle dark mode" }).click();
  await m.goto(`${BASE}/dashboard`);
  await m.getByText("Total Tasks").waitFor();
  ok(await m.evaluate(() => document.documentElement.classList.contains("dark")), "dark mode persists across navigation");
  await m.waitForTimeout(800);
  await shot(m, "11-dashboard-dark");
  const P = await browser.newContext({ ...devices["iPhone 13"] });
  const pp = await P.newPage();
  await pp.goto(`${BASE}/login`);
  await pp.getByLabel("Work email").fill("manager@supply.test");
  await pp.getByLabel("Password").fill(PW);
  await pp.getByRole("button", { name: "Sign in" }).click();
  await pp.waitForURL(/dashboard/);
  await pp.getByText("Total Tasks").waitFor();
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `mobile dashboard has no horizontal overflow (${overflow}px)`);
  await pp.screenshot({ path: `${SHOTS}/12-mobile-dashboard.png` });
  await pp.getByRole("button", { name: "Open menu" }).click();
  await pp.getByRole("link", { name: "All Tasks" }).click();
  await pp.waitForURL(/\/tasks/);
  await pp.getByRole("link", { name: /Peak season costing/ }).first().waitFor();
  ok(true, "mobile navigation drawer and card list work");
  await pp.screenshot({ path: `${SHOTS}/13-mobile-tasks.png` });
  await P.close();
  await L.ctx.close();

  console.log("Scheduler endpoint");
  ok((await fetch(`${BASE}/api/cron/monitor`)).status === 401, "cron endpoint rejects calls without the secret");
  const cron = await fetch(`${BASE}/api/cron/monitor`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret"}` } });
  ok(cron.status === 200, `cron endpoint runs the deadline monitor (${JSON.stringify(await cron.json())})`);
  ok((await fetch(`${BASE}/api/admin/users`, { method: "POST", body: "{}" })).status === 401, "admin API rejects anonymous callers");

  console.log(`\nALL E2E CHECKS PASSED (${passed})`);
  await M.ctx.close();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
