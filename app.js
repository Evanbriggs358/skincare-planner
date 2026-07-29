import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ---- Tab switching ----
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    tabButtons.forEach(b => b.classList.remove("active"));
    tabPanels.forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "calendar") renderCalendar();
    if (btn.dataset.tab === "history") renderHistoryPreview();
  });
});

// ---- Data ----
let steps = [];
let editingStepId = null;
let photos = {}; // { "2026-07-27": { dataUrl, uploadedAt } }

function saveSteps(newSteps) {
  steps = newSteps;
  syncToCloud();
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateToISO(d) {
  const copy = new Date(d);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function formatISOShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]} ${d}, ${y}`;
}

function describeFrequency(freq) {
  if (freq.type === "daily") return "Every day";
  if (freq.type === "everyOther") return `Every other day (from ${formatISOShort(freq.anchorDate)})`;
  const days = freq.days.slice().sort().map(d => DAY_LABELS[d]);
  return days.length ? days.join(", ") : "No days selected";
}

function describeDateRange(step) {
  if (!step.startDate && !step.endDate) return "";
  if (step.startDate && step.endDate) return ` · ${formatISOShort(step.startDate)} – ${formatISOShort(step.endDate)}`;
  if (step.startDate) return ` · from ${formatISOShort(step.startDate)}`;
  return ` · through ${formatISOShort(step.endDate)}`;
}

function render() {
  const morningList = document.getElementById("morning-list");
  const eveningList = document.getElementById("evening-list");
  morningList.innerHTML = "";
  eveningList.innerHTML = "";

  const morningSteps = steps.filter(s => s.time === "morning");
  const eveningSteps = steps.filter(s => s.time === "evening");

  if (morningSteps.length === 0) {
    morningList.innerHTML = `<li class="empty-note">No morning steps yet.</li>`;
  } else {
    morningSteps.forEach(s => morningList.appendChild(renderStepItem(s)));
  }

  if (eveningSteps.length === 0) {
    eveningList.innerHTML = `<li class="empty-note">No evening steps yet.</li>`;
  } else {
    eveningSteps.forEach(s => eveningList.appendChild(renderStepItem(s)));
  }
}

function renderStepItem(step) {
  const li = document.createElement("li");
  li.className = "step-item";
  li.innerHTML = `
    <div class="step-info">
      <div class="step-name">${escapeHtml(step.product)}</div>
      <div class="step-freq">${describeFrequency(step.frequency)}${describeDateRange(step)}</div>
    </div>
    <button class="edit-btn">Edit</button>
    <button class="delete-btn">Delete</button>
  `;
  li.querySelector(".edit-btn").addEventListener("click", () => openStepForm(step));
  li.querySelector(".delete-btn").addEventListener("click", () => deleteStep(step.id));
  return li;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function deleteStep(id) {
  steps = steps.filter(s => s.id !== id);
  saveSteps(steps);
  render();
}

// ---- Add/Edit step form ----
const stepForm = document.getElementById("step-form");
const stepFormTitle = document.getElementById("step-form-title");
const stepTimeSelect = document.getElementById("step-time");
const stepProductInput = document.getElementById("step-product");
const dayPicker = document.getElementById("day-picker");
const dayCheckboxes = dayPicker.querySelectorAll("input[type=checkbox]");
const everyOtherPicker = document.getElementById("everyother-picker");
const everyOtherDateInput = document.getElementById("everyother-date");
const stepStartDateInput = document.getElementById("step-start-date");
const stepEndDateInput = document.getElementById("step-end-date");

document.getElementById("add-step-btn").addEventListener("click", () => openStepForm(null));
document.getElementById("step-cancel-btn").addEventListener("click", closeStepForm);

document.querySelectorAll("input[name=freq-type]").forEach(radio => {
  radio.addEventListener("change", updateFrequencyFieldsVisibility);
});

function updateFrequencyFieldsVisibility() {
  const selected = document.querySelector("input[name=freq-type]:checked").value;
  dayPicker.classList.toggle("hidden", selected !== "days");
  everyOtherPicker.classList.toggle("hidden", selected !== "everyOther");
}

function openStepForm(step) {
  editingStepId = step ? step.id : null;
  stepFormTitle.textContent = step ? "Edit step" : "Add a step";
  stepTimeSelect.value = step ? step.time : "morning";
  stepProductInput.value = step ? step.product : "";

  const freqType = step ? step.frequency.type : "daily";
  document.querySelector(`input[name=freq-type][value="${freqType}"]`).checked = true;

  dayCheckboxes.forEach(cb => {
    cb.checked = step && step.frequency.type === "days"
      ? step.frequency.days.includes(Number(cb.value))
      : false;
  });

  everyOtherDateInput.value = step && step.frequency.type === "everyOther" ? step.frequency.anchorDate : "";
  stepStartDateInput.value = step && step.startDate ? step.startDate : "";
  stepEndDateInput.value = step && step.endDate ? step.endDate : "";

  updateFrequencyFieldsVisibility();
  stepForm.classList.remove("hidden");
  stepProductInput.focus();
}

function closeStepForm() {
  stepForm.classList.add("hidden");
  editingStepId = null;
}

document.getElementById("step-save-btn").addEventListener("click", () => {
  const product = stepProductInput.value.trim();
  if (!product) {
    stepProductInput.focus();
    return;
  }

  const time = stepTimeSelect.value;
  const freqType = document.querySelector("input[name=freq-type]:checked").value;
  let frequency;
  if (freqType === "daily") {
    frequency = { type: "daily" };
  } else if (freqType === "everyOther") {
    if (!everyOtherDateInput.value) {
      everyOtherDateInput.focus();
      return;
    }
    frequency = { type: "everyOther", anchorDate: everyOtherDateInput.value };
  } else {
    const days = Array.from(dayCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => Number(cb.value));
    frequency = { type: "days", days };
  }

  const startDate = stepStartDateInput.value || null;
  const endDate = stepEndDateInput.value || null;

  if (editingStepId) {
    const step = steps.find(s => s.id === editingStepId);
    step.time = time;
    step.product = product;
    step.frequency = frequency;
    step.startDate = startDate;
    step.endDate = endDate;
  } else {
    steps.push({
      id: crypto.randomUUID(),
      time,
      product,
      frequency,
      startDate,
      endDate
    });
  }

  saveSteps(steps);
  render();
  closeStepForm();
});

// ---- Acne Plan routine import ----
function mkStep(time, product, frequency, startDate, endDate) {
  return { id: crypto.randomUUID(), time, product, frequency, startDate: startDate || null, endDate: endDate || null };
}

function buildAcnePlanSteps() {
  const daily = { type: "daily" };
  return [
    // AM — every day
    mkStep("morning", "The Ordinary Hyaluronic Acid 2% + B5", daily),
    mkStep("morning", "Anua Azelaic Acid 10% + Hyaluron (AM)", daily),
    mkStep("morning", "Toleriane Double Repair Moisturizer (AM)", daily),
    mkStep("morning", "Cicaplast Baume B5 (AM)", daily),
    mkStep("morning", "Anthelios SPF 50 (Tinted Mineral)", daily),
    // PM — same every night regardless of Differin
    mkStep("evening", "The Ordinary Hyaluronic Acid 2% + B5 (PM)", daily),
    mkStep("evening", "Toleriane Double Repair Moisturizer (PM buffer)", daily),
    mkStep("evening", "Cicaplast Baume B5 (PM)", daily),
    // Differin — the 4 ramp phases
    mkStep("evening", "Differin (Adapalene) — Phase 1: twice weekly", { type: "days", days: [0, 3] }, "2026-07-27", "2026-08-10"),
    mkStep("evening", "Differin (Adapalene) — Phase 2: every other night", { type: "everyOther", anchorDate: "2026-08-11" }, "2026-08-11", "2026-08-24"),
    mkStep("evening", "Differin (Adapalene) — Phase 3: most nights", { type: "days", days: [1, 2, 3, 5, 6] }, "2026-08-25", "2026-09-07"),
    mkStep("evening", "Differin (Adapalene) — Phase 4: nightly", daily, "2026-09-08", null),
    // Topicals Faded Brightening Serum — PM, non-Differin nights only (Azelaic Acid stays AM-only; mirrors the Differin phases, none needed once Differin goes nightly)
    mkStep("evening", "Topicals Faded Brightening Serum (PM, non-Differin nights)", { type: "days", days: [1, 2, 4, 5, 6] }, "2026-07-27", "2026-08-10"),
    mkStep("evening", "Topicals Faded Brightening Serum (PM, non-Differin nights)", { type: "everyOther", anchorDate: "2026-08-12" }, "2026-08-11", "2026-08-24"),
    mkStep("evening", "Topicals Faded Brightening Serum (PM, non-Differin nights)", { type: "days", days: [0, 4] }, "2026-08-25", "2026-09-07"),
    // TreeActiv — non-Differin nights only, on active cysts
    mkStep("evening", "TreeActiv Cystic Spot Treatment (non-Differin nights, active cysts only)", { type: "days", days: [1, 2, 4, 5, 6] }, "2026-07-27", "2026-08-10"),
    mkStep("evening", "TreeActiv Cystic Spot Treatment (non-Differin nights, active cysts only)", { type: "everyOther", anchorDate: "2026-08-12" }, "2026-08-11", "2026-08-24"),
    mkStep("evening", "TreeActiv Cystic Spot Treatment (non-Differin nights, active cysts only)", { type: "days", days: [0, 4] }, "2026-08-25", "2026-09-07")
  ];
}

document.getElementById("import-acne-plan-btn").addEventListener("click", () => {
  const confirmed = confirm("This will replace your current routine steps with the full Acne Plan routine (Jul 27 onward, including the phased Differin ramp). Continue?");
  if (!confirmed) return;
  saveSteps(buildAcnePlanSteps());
  render();
});

// ---- Calendar (day / week / month views) ----
const MILESTONES = [
  { date: "2026-08-10", label: "Check-in: twice-weekly Differin tolerated well? → advance to every-other-night. Irritated? → hold another week." },
  { date: "2026-08-24", label: "Check-in: comfortable on every-other-night? → begin tightening toward most nights. Watch for a possible purge peak." },
  { date: "2026-09-07", label: "Check-in: skin calm and comfortable? → consider moving to nightly. Any irritation? → hold at most-nights." },
  { date: "2026-09-21", label: "2-month assessment: evaluate texture, breakout frequency, redness, and trend vs. the late-July baseline." }
];

let calendarView = "week";
let calendarDate = new Date();
calendarDate.setHours(0, 0, 0, 0);

function stepAppliesOnDate(step, date) {
  const iso = dateToISO(date);
  if (step.startDate && iso < step.startDate) return false;
  if (step.endDate && iso > step.endDate) return false;

  const freq = step.frequency;
  if (freq.type === "daily") return true;
  if (freq.type === "days") return freq.days.includes(date.getDay());
  if (freq.type === "everyOther") {
    const anchor = new Date(freq.anchorDate + "T00:00:00");
    const diffDays = Math.round((date - anchor) / (1000 * 60 * 60 * 24));
    return ((diffDays % 2) + 2) % 2 === 0;
  }
  return false;
}

function isDifferinNight(date) {
  return steps.some(s => s.time === "evening" && /^differin/i.test(s.product.trim()) && stepAppliesOnDate(s, date));
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // back up to Sunday
  return d;
}

function formatDayHeading(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDayHeadingLong(date) {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function renderDaySteps(list) {
  if (list.length === 0) return `<div class="day-none">Nothing scheduled</div>`;
  return list.map(s => `<div class="day-step">${escapeHtml(s.product)}</div>`).join("");
}

function buildDayCardHtml(date, today, extraClass) {
  const morning = steps.filter(s => s.time === "morning" && stepAppliesOnDate(s, date));
  const evening = steps.filter(s => s.time === "evening" && stepAppliesOnDate(s, date));
  const isToday = isSameDay(date, today);
  const milestone = MILESTONES.find(m => m.date === dateToISO(date));
  const isDayView = !!extraClass;
  const differinNight = isDifferinNight(date);
  const dayPhotos = photos[dateToISO(date)];

  return `
    ${milestone && isDayView ? `<div class="milestone-banner">📋 ${escapeHtml(milestone.label)}</div>` : ""}
    <div class="day-card ${extraClass || ""} ${isToday ? "is-today" : ""} ${differinNight ? "is-differin-night" : ""} ${dayPhotos ? "has-photo" : ""}">
      <div class="day-card-header">
        <span>${isDayView ? formatDayHeadingLong(date) : formatDayHeading(date)} ${milestone && !isDayView ? "📋" : ""}</span>
        ${isToday ? '<span class="today-tag">Today</span>' : ""}
      </div>
      <div class="day-section-label">Morning</div>
      ${renderDaySteps(morning)}
      <div class="day-section-label">Evening ${differinNight ? '<span class="differin-tag">🔴 Differin night</span>' : ""}</div>
      ${renderDaySteps(evening)}
      ${dayPhotos && isDayView ? `
        <div class="day-photos-row">
          ${CAMERA_ANGLES.map(({ key }) => dayPhotos[key]
            ? `<button type="button" class="day-photo-thumb" data-date="${dateToISO(date)}"><img src="${dayPhotos[key].dataUrl}" alt="${key} photo"></button>`
            : ""
          ).join("")}
        </div>
      ` : ""}
      ${isDayView ? buildScoreBarsHtml(dateToISO(date)) : ""}
    </div>
  `;
}

function renderDayView(container) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  container.innerHTML = buildDayCardHtml(calendarDate, today, "day-view-card");
  const dayPhotos = photos[dateToISO(calendarDate)];
  const group = dayPhotos ? dayPhotoGroup(dayPhotos) : [];
  container.querySelectorAll(".day-photo-thumb").forEach((btn, idx) => {
    btn.addEventListener("click", () => openFullscreenViewer(group, idx));
  });
}

function renderWeekViewInto(container) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = startOfWeek(calendarDate);

  let html = "";
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    html += buildDayCardHtml(date, today, "");
  }
  container.innerHTML = html;
}

function renderMonthView(container) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const gridStart = new Date(year, month, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  let cellsHtml = "";
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(cellDate.getDate() + i);
    const inMonth = cellDate.getMonth() === month;
    const hasMorning = steps.some(s => s.time === "morning" && stepAppliesOnDate(s, cellDate));
    const hasEvening = steps.some(s => s.time === "evening" && stepAppliesOnDate(s, cellDate));
    const hasMilestone = MILESTONES.some(m => m.date === dateToISO(cellDate));
    const differinNight = isDifferinNight(cellDate);
    const isPast = cellDate < today;
    const hasPhoto = !!photos[dateToISO(cellDate)];

    cellsHtml += `
      <button type="button" class="month-cell ${inMonth ? "" : "is-outside"} ${isSameDay(cellDate, today) ? "is-today" : ""} ${hasMilestone ? "has-milestone" : ""} ${differinNight ? "is-differin" : ""} ${isPast ? "is-past" : ""} ${hasPhoto ? "has-photo" : ""}" data-date="${cellDate.getTime()}">
        <span>${cellDate.getDate()}${hasMilestone ? " 📋" : ""}</span>
        <span class="month-cell-dots">
          ${hasMorning ? '<span class="dot dot-am"></span>' : ""}
          ${differinNight ? '<span class="dot dot-differin"></span>' : (hasEvening ? '<span class="dot dot-pm"></span>' : "")}
        </span>
      </button>
    `;
  }

  container.innerHTML = `
    <div class="month-heading">${calendarDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
    <div class="month-grid">
      ${DAY_LABELS.map(d => `<div class="month-dow">${d}</div>`).join("")}
      ${cellsHtml}
    </div>
  `;

  container.querySelectorAll(".month-cell").forEach(btn => {
    btn.addEventListener("click", () => {
      calendarDate = new Date(Number(btn.dataset.date));
      calendarView = "day";
      setActiveViewButton();
      renderCalendar();
    });
  });
}

function renderCalendar() {
  const container = document.getElementById("calendar-view");
  if (calendarView === "day") renderDayView(container);
  else if (calendarView === "week") renderWeekViewInto(container);
  else renderMonthView(container);
}

function setActiveViewButton() {
  document.querySelectorAll(".view-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === calendarView);
  });
}

document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    calendarView = btn.dataset.view;
    setActiveViewButton();
    renderCalendar();
  });
});

document.getElementById("week-prev-btn").addEventListener("click", () => {
  navigateCalendar(-1);
});
document.getElementById("week-next-btn").addEventListener("click", () => {
  navigateCalendar(1);
});
document.getElementById("week-today-btn").addEventListener("click", () => {
  calendarDate = new Date();
  calendarDate.setHours(0, 0, 0, 0);
  renderCalendar();
});

function navigateCalendar(direction) {
  const d = new Date(calendarDate);
  if (calendarView === "day") d.setDate(d.getDate() + direction);
  else if (calendarView === "week") d.setDate(d.getDate() + direction * 7);
  else d.setMonth(d.getMonth() + direction);
  calendarDate = d;
  renderCalendar();
}

// ---- Check-in ----
const QUESTIONS = [
  { key: "dryness", label: "Dryness", low: "None", high: "Severe" },
  { key: "irritation", label: "Irritation", low: "None", high: "Severe" },
  { key: "breakouts", label: "Breakouts", low: "None", high: "Severe" },
  { key: "inflammation", label: "Inflammation", low: "None", high: "Severe" }
];

// The 5 bars shown in Compare / the daily log / Calendar day view.
// Improvement isn't asked directly — it's computed from check-in history.
const BAR_CATEGORIES = [
  { key: "dryness", label: "Dryness", higherIsBetter: false },
  { key: "irritation", label: "Irritation", higherIsBetter: false },
  { key: "breakouts", label: "Breakouts", higherIsBetter: false },
  { key: "inflammation", label: "Inflammation", higherIsBetter: false },
  { key: "improvement", label: "Improvement", higherIsBetter: true }
];

function checkinAverage(c) {
  const inflammation = c.inflammation ?? c.oiliness ?? 3;
  return (c.dryness + c.irritation + c.breakouts + inflammation) / 4;
}

function computeImprovement(iso) {
  const sorted = [...checkins].sort((a, b) => a.date.localeCompare(b.date));
  const index = sorted.findIndex(c => c.date === iso);
  if (index === -1) return { state: "none" };
  if (index === 0) return { state: "no-data" };

  const baseline = sorted[0];
  const previous = sorted[index - 1];
  const current = sorted[index];

  const deltaFromBaseline = checkinAverage(baseline) - checkinAverage(current);
  const deltaFromPrevious = checkinAverage(previous) - checkinAverage(current);
  const blended = (deltaFromBaseline + deltaFromPrevious) / 2;

  let value;
  if (blended <= -1) value = 1;
  else if (blended < -0.25) value = 2;
  else if (blended <= 0.25) value = 3;
  else if (blended < 1) value = 4;
  else value = 5;

  return { state: "computed", value };
}

function barColorClass(value, higherIsBetter) {
  const isGood = higherIsBetter ? value >= 4 : value <= 2;
  const isBad = higherIsBetter ? value <= 2 : value >= 4;
  if (isGood) return "bar-green";
  if (isBad) return "bar-red";
  return "bar-yellow";
}

function findCheckin(iso) {
  return checkins.find(c => c.date === iso) || null;
}

function buildScoreBarsHtml(iso) {
  const checkin = findCheckin(iso);
  if (!checkin) return "";

  const rows = BAR_CATEGORIES.map(cat => {
    if (cat.key === "improvement") {
      const improvement = computeImprovement(iso);
      if (improvement.state === "no-data") {
        return `
          <div class="score-bar-row">
            <span class="score-bar-label">${cat.label}</span>
            <span class="score-bar-track"><span class="score-bar-fill bar-neutral" style="width:100%"></span></span>
            <span class="score-bar-value">—</span>
          </div>
        `;
      }
      return scoreBarRowHtml(cat.label, improvement.value, cat.higherIsBetter);
    }
    const value = checkin[cat.key] ?? (cat.key === "inflammation" ? checkin.oiliness : null);
    if (value == null) return "";
    return scoreBarRowHtml(cat.label, value, cat.higherIsBetter);
  }).join("");

  return `<div class="score-bars">${rows}</div>`;
}

function scoreBarRowHtml(label, value, higherIsBetter) {
  const colorClass = barColorClass(value, higherIsBetter);
  const widthPct = (value / 5) * 100;
  return `
    <div class="score-bar-row">
      <span class="score-bar-label">${label}</span>
      <span class="score-bar-track"><span class="score-bar-fill ${colorClass}" style="width:${widthPct}%"></span></span>
      <span class="score-bar-value">${value}/5</span>
    </div>
  `;
}

let checkins = [];
let intervalDays = 3;
let checkinAnswers = {};

function saveCheckins(list) {
  checkins = list;
  syncToCloud();
}

function saveInterval(days) {
  intervalDays = days;
  syncToCloud();
}

function todayISO() {
  return dateToISO(new Date());
}

function daysBetween(isoDateA, isoDateB) {
  const a = new Date(isoDateA + "T00:00:00");
  const b = new Date(isoDateB + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function renderCheckinStatus() {
  const el = document.getElementById("checkin-status");

  if (checkins.length === 0) {
    el.textContent = "No check-ins yet — let's do your first one.";
    el.classList.add("due");
    return;
  }

  const sorted = [...checkins].sort((a, b) => b.date.localeCompare(a.date));
  const lastDate = sorted[0].date;
  const daysSince = daysBetween(lastDate, todayISO());
  const daysUntilDue = intervalDays - daysSince;

  if (daysUntilDue <= 0) {
    el.textContent = `Last check-in was ${daysSince} day${daysSince === 1 ? "" : "s"} ago. A new check-in is due!`;
    el.classList.add("due");
  } else {
    el.textContent = `Last check-in: ${lastDate}. Next one due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`;
    el.classList.remove("due");
  }
}

function renderCheckinQuestions() {
  const container = document.getElementById("checkin-questions");
  container.innerHTML = "";
  checkinAnswers = {};

  QUESTIONS.forEach(q => {
    const block = document.createElement("div");
    block.className = "question-block";
    block.innerHTML = `
      <div class="q-label">${q.label}</div>
      <div class="q-hint">${q.low} &rarr; ${q.high}</div>
      <div class="scale" data-key="${q.key}">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-value="${n}">${n}</button>`).join("")}
      </div>
    `;
    const scaleEl = block.querySelector(".scale");
    scaleEl.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        checkinAnswers[q.key] = Number(btn.dataset.value);
        scaleEl.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });
    container.appendChild(block);
  });
}

function openCheckinForm() {
  renderCheckinQuestions();
  document.getElementById("checkin-form").classList.remove("hidden");
}

function closeCheckinForm() {
  document.getElementById("checkin-form").classList.add("hidden");
}

document.getElementById("add-checkin-btn").addEventListener("click", openCheckinForm);
document.getElementById("checkin-cancel-btn").addEventListener("click", closeCheckinForm);

document.getElementById("checkin-save-btn").addEventListener("click", () => {
  if (Object.keys(checkinAnswers).length < QUESTIONS.length) {
    alert("Please answer all questions before saving.");
    return;
  }

  checkins.push({
    id: crypto.randomUUID(),
    date: todayISO(),
    ...checkinAnswers
  });
  saveCheckins(checkins);
  renderCheckinStatus();
  renderUnifiedTimeline();
  renderCompareSection();
  closeCheckinForm();
});

document.getElementById("interval-input").addEventListener("change", e => {
  const days = Math.max(1, Number(e.target.value) || 3);
  saveInterval(days);
  renderCheckinStatus();
});

// ---- History export ----
function buildHistoryText() {
  const lines = [];
  lines.push(`SKINCARE ROUTINE — exported ${todayISO()}`);
  lines.push("");

  lines.push("MORNING");
  const morning = steps.filter(s => s.time === "morning");
  if (morning.length === 0) {
    lines.push("(none)");
  } else {
    morning.forEach(s => lines.push(`- ${s.product} (${describeFrequency(s.frequency)}${describeDateRange(s)})`));
  }
  lines.push("");

  lines.push("EVENING");
  const evening = steps.filter(s => s.time === "evening");
  if (evening.length === 0) {
    lines.push("(none)");
  } else {
    evening.forEach(s => lines.push(`- ${s.product} (${describeFrequency(s.frequency)}${describeDateRange(s)})`));
  }
  lines.push("");

  lines.push("CHECK-IN HISTORY");
  if (checkins.length === 0) {
    lines.push("(none)");
  } else {
    const sorted = [...checkins].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach(c => {
      const values = QUESTIONS.map(q => `${q.label} ${c[q.key]}/5`).join(", ");
      const improvement = computeImprovement(c.date);
      const improvementText = improvement.state === "computed" ? `${improvement.value}/5` : "n/a (first check-in)";
      lines.push(`${c.date}: ${values}, Improvement ${improvementText}`);
    });
  }

  return lines.join("\n");
}

function renderHistoryPreview() {
  document.getElementById("history-preview").value = buildHistoryText();
}

document.getElementById("copy-history-btn").addEventListener("click", async () => {
  const text = buildHistoryText();
  document.getElementById("history-preview").value = text;
  const statusEl = document.getElementById("copy-status");
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "Copied! Paste it wherever you like.";
  } catch (err) {
    statusEl.textContent = "Couldn't copy automatically — select the text below and copy it manually.";
  }
});

// ---- Photos ----
async function compressImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    bitmap = await createImageBitmap(file);
  }

  const maxDim = 1000;
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

  let quality = 0.8;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > 700000 && quality > 0.2) {
    quality -= 0.15;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return dataUrl;
}

async function savePhotoBlob(blob, angle) {
  if (!photosCollectionRef) return;
  const statusEl = document.getElementById("photo-upload-status");
  statusEl.textContent = `Processing ${angle} photo...`;
  try {
    const dataUrl = await compressImage(blob);
    const iso = todayISO();
    await setDoc(doc(photosCollectionRef, `${iso}_${angle}`), { date: iso, angle, dataUrl, uploadedAt: new Date().toISOString() });
    statusEl.textContent = `Saved ${angle} photo.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Couldn't process that photo — try again.";
  }
}

// ---- Custom camera view with alignment guide (3-angle sequence) ----
const CAMERA_ANGLES = [
  { key: "left", label: "Left side" },
  { key: "center", label: "Straight on" },
  { key: "right", label: "Right side" }
];
let cameraStream = null;
let cameraSequenceIndex = 0;
let usingFileFallback = false;

function updateCameraStepUI() {
  const step = CAMERA_ANGLES[cameraSequenceIndex];
  document.getElementById("camera-step-label").textContent = `Photo ${cameraSequenceIndex + 1} of 3 — ${step.label}`;
  document.getElementById("camera-capture-btn").textContent = `Capture: ${step.label}`;
}

async function openCamera() {
  if (!photosCollectionRef) return;
  cameraSequenceIndex = 0;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    usingFileFallback = true;
    document.getElementById("photo-file-input").click();
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    usingFileFallback = false;
    document.getElementById("camera-video").srcObject = cameraStream;
    document.getElementById("camera-view").classList.remove("hidden");
    updateCameraStepUI();
  } catch (err) {
    console.error(err);
    usingFileFallback = true;
    document.getElementById("photo-file-input").click();
  }
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  document.getElementById("camera-view").classList.add("hidden");
}

function advanceSequenceOrFinish() {
  cameraSequenceIndex += 1;
  if (cameraSequenceIndex >= CAMERA_ANGLES.length) {
    closeCamera();
    document.getElementById("photo-upload-status").textContent = "Saved today's 3 photos.";
    return;
  }
  if (usingFileFallback) {
    document.getElementById("photo-file-input").click();
  } else {
    updateCameraStepUI();
  }
}

document.getElementById("open-camera-btn").addEventListener("click", openCamera);
document.getElementById("camera-cancel-btn").addEventListener("click", closeCamera);

document.getElementById("camera-capture-btn").addEventListener("click", () => {
  const video = document.getElementById("camera-video");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);
  canvas.toBlob(async blob => {
    if (!blob) return;
    const angle = CAMERA_ANGLES[cameraSequenceIndex].key;
    await savePhotoBlob(blob, angle);
    advanceSequenceOrFinish();
  }, "image/jpeg", 0.92);
});

document.getElementById("photo-file-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const angle = CAMERA_ANGLES[cameraSequenceIndex].key;
  await savePhotoBlob(file, angle);
  advanceSequenceOrFinish();
});

function renderUnifiedTimeline() {
  const container = document.getElementById("unified-timeline");
  const dateSet = new Set([...Object.keys(photos), ...checkins.map(c => c.date)]);
  const dates = Array.from(dateSet).sort().reverse();

  if (dates.length === 0) {
    container.innerHTML = `<p class="empty-note">No photos or check-ins yet.</p>`;
    return;
  }

  container.innerHTML = dates.map(iso => {
    const day = photos[iso];
    const thumbsHtml = day ? `
      <div class="photo-day-thumbs">
        ${CAMERA_ANGLES.map(({ key }) => day[key]
          ? `<img src="${day[key].dataUrl}" alt="${key} photo from ${formatISOShort(iso)}">`
          : `<div class="angle-missing"></div>`
        ).join("")}
      </div>
    ` : "";
    return `
      <button type="button" class="photo-day-card" data-date="${iso}">
        <div class="photo-day-date">${formatISOShort(iso)}</div>
        ${thumbsHtml}
        ${buildScoreBarsHtml(iso)}
      </button>
    `;
  }).join("");

  container.querySelectorAll(".photo-day-card").forEach(cardBtn => {
    cardBtn.addEventListener("click", () => openLightbox(cardBtn.dataset.date));
    const day = photos[cardBtn.dataset.date];
    if (!day) return;
    const group = dayPhotoGroup(day);
    cardBtn.querySelectorAll(".photo-day-thumbs img").forEach((img, idx) => {
      img.addEventListener("click", e => {
        e.stopPropagation();
        openFullscreenViewer(group, idx);
      });
    });
  });
}

// ---- Full-screen photo viewer ----
function dayPhotoGroup(day) {
  return CAMERA_ANGLES.filter(({ key }) => day[key]).map(({ key }) => day[key].dataUrl);
}

let fullscreenGroup = [];
let fullscreenIndex = 0;

function openFullscreenViewer(group, startIndex) {
  const list = Array.isArray(group) ? group : [group];
  if (!list.length || !list[0]) return;
  fullscreenGroup = list;
  fullscreenIndex = startIndex || 0;
  showFullscreenImage();
  document.getElementById("fullscreen-viewer").classList.remove("hidden");
}

function showFullscreenImage() {
  document.getElementById("fullscreen-viewer-img").src = fullscreenGroup[fullscreenIndex];
  const multi = fullscreenGroup.length > 1;
  document.getElementById("fullscreen-prev-btn").classList.toggle("hidden", !multi);
  document.getElementById("fullscreen-next-btn").classList.toggle("hidden", !multi);
  document.getElementById("fullscreen-counter").textContent = multi ? `${fullscreenIndex + 1} / ${fullscreenGroup.length}` : "";
}

function showNextFullscreenImage() {
  if (fullscreenGroup.length < 2) return;
  fullscreenIndex = (fullscreenIndex + 1) % fullscreenGroup.length;
  showFullscreenImage();
}

function showPrevFullscreenImage() {
  if (fullscreenGroup.length < 2) return;
  fullscreenIndex = (fullscreenIndex - 1 + fullscreenGroup.length) % fullscreenGroup.length;
  showFullscreenImage();
}

function closeFullscreenViewer() {
  document.getElementById("fullscreen-viewer").classList.add("hidden");
  document.getElementById("fullscreen-viewer-img").src = "";
  fullscreenGroup = [];
  fullscreenIndex = 0;
}

const fullscreenViewerEl = document.getElementById("fullscreen-viewer");
let fullscreenSwiped = false;
let fullscreenTouchStartX = null;

fullscreenViewerEl.addEventListener("touchstart", e => {
  fullscreenSwiped = false;
  fullscreenTouchStartX = e.touches[0].clientX;
}, { passive: true });

fullscreenViewerEl.addEventListener("touchmove", e => {
  if (fullscreenTouchStartX === null) return;
  e.preventDefault();
}, { passive: false });

function finishFullscreenTouch(e) {
  if (fullscreenTouchStartX === null) return;
  const deltaX = e.changedTouches[0].clientX - fullscreenTouchStartX;
  fullscreenTouchStartX = null;
  const SWIPE_THRESHOLD = 40;
  if (deltaX > SWIPE_THRESHOLD) {
    fullscreenSwiped = true;
    showPrevFullscreenImage();
  } else if (deltaX < -SWIPE_THRESHOLD) {
    fullscreenSwiped = true;
    showNextFullscreenImage();
  }
}

fullscreenViewerEl.addEventListener("touchend", finishFullscreenTouch);
fullscreenViewerEl.addEventListener("touchcancel", finishFullscreenTouch);

fullscreenViewerEl.addEventListener("click", () => {
  if (fullscreenSwiped) {
    fullscreenSwiped = false;
    return;
  }
  closeFullscreenViewer();
});

document.getElementById("fullscreen-close-btn").addEventListener("click", e => {
  e.stopPropagation();
  closeFullscreenViewer();
});
document.getElementById("fullscreen-prev-btn").addEventListener("click", e => {
  e.stopPropagation();
  showPrevFullscreenImage();
});
document.getElementById("fullscreen-next-btn").addEventListener("click", e => {
  e.stopPropagation();
  showNextFullscreenImage();
});
document.addEventListener("keydown", e => {
  if (fullscreenViewerEl.classList.contains("hidden")) return;
  if (e.key === "Escape") closeFullscreenViewer();
  if (e.key === "ArrowRight") showNextFullscreenImage();
  if (e.key === "ArrowLeft") showPrevFullscreenImage();
});

document.getElementById("compare-img-a").addEventListener("click", () => openCompareFullscreen("a"));
document.getElementById("compare-img-b").addEventListener("click", () => openCompareFullscreen("b"));

function openCompareFullscreen(slot) {
  const img = document.getElementById(`compare-img-${slot}`);
  if (img.classList.contains("hidden")) return;
  const iso = document.getElementById(`compare-date-${slot}`).value;
  const day = photos[iso];
  if (!day) return;
  const angles = CAMERA_ANGLES.filter(({ key }) => day[key]);
  const group = angles.map(({ key }) => day[key].dataUrl);
  const currentAngle = document.getElementById("compare-angle-select").value;
  const idx = Math.max(0, angles.findIndex(({ key }) => key === currentAngle));
  openFullscreenViewer(group, idx);
}

["left", "center", "right"].forEach(angle => {
  document.getElementById(`lightbox-img-${angle}`).addEventListener("click", () => {
    const iso = document.getElementById("photo-lightbox").dataset.date;
    const day = photos[iso];
    if (!day) return;
    const angles = CAMERA_ANGLES.filter(({ key }) => day[key]);
    const group = angles.map(({ key }) => day[key].dataUrl);
    const idx = angles.findIndex(({ key }) => key === angle);
    if (idx === -1) return;
    openFullscreenViewer(group, idx);
  });
});

// ---- Scrub-through-history wipe comparison viewer ----
function getAngleSequence(angle) {
  return Object.keys(photos)
    .filter(iso => photos[iso][angle])
    .sort()
    .map(iso => ({ iso, dataUrl: photos[iso][angle].dataUrl }));
}

let wipeSequence = [];
let wipeIndex = 0;
let wipeDirection = 0; // -1 = revealing the next (newer) photo, 1 = revealing the previous (older) photo
let wipeDragStartX = null;
let wipeDragDeltaX = 0;
let wipeStageWidth = 0;

const wipeStageEl = document.getElementById("wipe-stage");
const wipeCurrentImgEl = document.getElementById("wipe-img-current");
const wipeNextImgEl = document.getElementById("wipe-img-next");

function openWipeViewer() {
  const angle = document.getElementById("wipe-angle-select").value;
  wipeSequence = getAngleSequence(angle);
  wipeIndex = wipeSequence.length - 1;

  const hasEnough = wipeSequence.length >= 2;
  document.getElementById("wipe-empty-note").classList.toggle("hidden", hasEnough);
  wipeStageEl.classList.toggle("hidden", !hasEnough || wipeSequence.length === 0);

  if (wipeSequence.length > 0) renderWipeCurrent();
  document.getElementById("wipe-viewer").classList.remove("hidden");
}

function closeWipeViewer() {
  document.getElementById("wipe-viewer").classList.add("hidden");
}

function setWipeClip(revealPercent, direction) {
  if (direction === -1) {
    wipeCurrentImgEl.style.clipPath = `inset(0 ${revealPercent}% 0 0)`;
  } else if (direction === 1) {
    wipeCurrentImgEl.style.clipPath = `inset(0 0 0 ${revealPercent}%)`;
  } else {
    wipeCurrentImgEl.style.clipPath = "inset(0 0 0 0)";
  }
}

function renderWipeCurrent() {
  const cur = wipeSequence[wipeIndex];
  wipeCurrentImgEl.style.transition = "none";
  setWipeClip(0, 0);
  wipeCurrentImgEl.src = cur.dataUrl;
  wipeNextImgEl.src = "";
  document.getElementById("wipe-date-label").textContent = formatISOShort(cur.iso);
  document.getElementById("wipe-counter").textContent = `${wipeIndex + 1} / ${wipeSequence.length}`;
}

function wipeDragStart(clientX) {
  if (wipeSequence.length < 2) return;
  wipeDragStartX = clientX;
  wipeDragDeltaX = 0;
  wipeDirection = 0;
  wipeStageWidth = wipeStageEl.clientWidth;
  wipeCurrentImgEl.style.transition = "none";
}

function wipeDragMove(clientX) {
  if (wipeDragStartX === null) return;
  const rawDelta = clientX - wipeDragStartX;

  if (wipeDirection === 0 && Math.abs(rawDelta) > 5) {
    const dir = rawDelta < 0 ? -1 : 1;
    const targetIdx = wipeIndex - dir;
    if (targetIdx < 0 || targetIdx >= wipeSequence.length) return; // no photo that way — ignore
    wipeDirection = dir;
    wipeNextImgEl.style.transition = "none";
    wipeNextImgEl.src = wipeSequence[targetIdx].dataUrl;
  }

  if (wipeDirection === 0) return;

  wipeDragDeltaX = rawDelta;
  const revealPercent = Math.min(100, (Math.abs(wipeDragDeltaX) / wipeStageWidth) * 100);
  setWipeClip(revealPercent, wipeDirection);

  const targetIdx = wipeIndex - wipeDirection;
  const curIso = wipeSequence[wipeIndex].iso;
  const otherIso = wipeSequence[targetIdx].iso;
  document.getElementById("wipe-date-label").textContent = wipeDirection === -1
    ? `${formatISOShort(curIso)} → ${formatISOShort(otherIso)}`
    : `${formatISOShort(otherIso)} ← ${formatISOShort(curIso)}`;
}

function wipeDragEnd() {
  if (wipeDragStartX === null) return;
  wipeDragStartX = null;
  if (wipeDirection === 0) return;

  const threshold = wipeStageWidth * 0.3;
  wipeCurrentImgEl.style.transition = "clip-path 0.2s ease";

  if (Math.abs(wipeDragDeltaX) > threshold) {
    setWipeClip(100, wipeDirection);
    const committedIndex = wipeIndex - wipeDirection;
    setTimeout(() => {
      wipeIndex = committedIndex;
      renderWipeCurrent();
    }, 200);
  } else {
    setWipeClip(0, wipeDirection);
    setTimeout(() => {
      wipeNextImgEl.src = "";
      document.getElementById("wipe-date-label").textContent = formatISOShort(wipeSequence[wipeIndex].iso);
    }, 200);
  }
  wipeDirection = 0;
}

document.getElementById("open-wipe-btn").addEventListener("click", openWipeViewer);
document.getElementById("wipe-close-btn").addEventListener("click", closeWipeViewer);
document.getElementById("wipe-angle-select").addEventListener("change", openWipeViewer);

wipeStageEl.addEventListener("touchstart", e => wipeDragStart(e.touches[0].clientX), { passive: true });
wipeStageEl.addEventListener("touchmove", e => {
  if (wipeDragStartX === null) return;
  e.preventDefault();
  wipeDragMove(e.touches[0].clientX);
}, { passive: false });
wipeStageEl.addEventListener("touchend", wipeDragEnd);
wipeStageEl.addEventListener("touchcancel", wipeDragEnd);

wipeStageEl.addEventListener("mousedown", e => {
  wipeDragStart(e.clientX);
  const onMove = ev => wipeDragMove(ev.clientX);
  const onUp = () => {
    wipeDragEnd();
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

function renderCompareSection() {
  const dates = Object.keys(photos).sort();
  const dateA = document.getElementById("compare-date-a");
  const dateB = document.getElementById("compare-date-b");

  if (!dateA.value) dateA.value = dates.length ? dates[0] : todayISO();
  if (!dateB.value) dateB.value = dates.length ? dates[dates.length - 1] : todayISO();

  updateCompareImages();
}

function setCompareSlot(slot, iso, angle) {
  const img = document.getElementById(`compare-img-${slot}`);
  const emptyNote = document.getElementById(`compare-empty-${slot}`);
  const dataUrl = iso ? photos[iso]?.[angle]?.dataUrl : null;

  if (dataUrl) {
    img.src = dataUrl;
    img.classList.remove("hidden");
    emptyNote.classList.add("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    emptyNote.classList.remove("hidden");
  }
}

function updateCompareImages() {
  const isoA = document.getElementById("compare-date-a").value;
  const isoB = document.getElementById("compare-date-b").value;
  const angle = document.getElementById("compare-angle-select").value;
  setCompareSlot("a", isoA, angle);
  setCompareSlot("b", isoB, angle);
  document.getElementById("compare-bars-a").innerHTML = buildScoreBarsHtml(isoA);
  document.getElementById("compare-bars-b").innerHTML = buildScoreBarsHtml(isoB);
}

document.getElementById("compare-date-a").addEventListener("change", updateCompareImages);
document.getElementById("compare-date-b").addEventListener("change", updateCompareImages);
document.getElementById("compare-angle-select").addEventListener("change", updateCompareImages);

function openLightbox(iso) {
  const day = photos[iso];
  document.getElementById("lightbox-date").textContent = formatISOShort(iso);

  const anglesEl = document.querySelector(".lightbox-angles");
  const deleteBtn = document.getElementById("lightbox-delete-btn");
  if (day) {
    anglesEl.classList.remove("hidden");
    deleteBtn.classList.remove("hidden");
    document.getElementById("lightbox-img-left").src = day.left?.dataUrl || "";
    document.getElementById("lightbox-img-center").src = day.center?.dataUrl || "";
    document.getElementById("lightbox-img-right").src = day.right?.dataUrl || "";
  } else {
    anglesEl.classList.add("hidden");
    deleteBtn.classList.add("hidden");
  }

  document.getElementById("lightbox-bars").innerHTML = buildScoreBarsHtml(iso);

  const lightbox = document.getElementById("photo-lightbox");
  lightbox.dataset.date = iso;
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  document.getElementById("photo-lightbox").classList.add("hidden");
}

document.getElementById("lightbox-close-btn").addEventListener("click", closeLightbox);

document.getElementById("lightbox-delete-btn").addEventListener("click", async () => {
  const iso = document.getElementById("photo-lightbox").dataset.date;
  if (!iso || !photosCollectionRef) return;
  if (!confirm(`Delete all photos from ${formatISOShort(iso)}?`)) return;
  await Promise.all(CAMERA_ANGLES.map(({ key }) => deleteDoc(doc(photosCollectionRef, `${iso}_${key}`))));
  closeLightbox();
});

function renderAll() {
  render();
  renderCheckinStatus();
  renderUnifiedTimeline();
  renderCompareSection();
  document.getElementById("interval-input").value = intervalDays;
  const calendarTabActive = document.querySelector('.tab-btn[data-tab="calendar"]').classList.contains("active");
  if (calendarTabActive) renderCalendar();
}

// ---- Cloud connection & passphrase gate ----
const HASH_STORAGE_KEY = "skincare-user-hash";
let userDocRef = null;
let photosCollectionRef = null;
let unsubscribeSnapshot = null;
let unsubscribePhotos = null;

async function hashPassphrase(text) {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function showGate(message) {
  document.getElementById("app-content").classList.add("hidden");
  document.getElementById("passphrase-gate").classList.remove("hidden");
  document.getElementById("gate-status").textContent = message || "";
}

function showApp() {
  document.getElementById("passphrase-gate").classList.add("hidden");
  document.getElementById("app-content").classList.remove("hidden");
}

function syncToCloud() {
  if (!userDocRef) return;
  setDoc(userDocRef, { steps, checkins, intervalDays });
}

async function connect(hash) {
  document.getElementById("gate-status").textContent = "Connecting...";
  const ref = doc(db, "users", hash);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { steps: [], checkins: [], intervalDays: 3 });
    }
  } catch (err) {
    showGate("Couldn't connect. Check your internet connection and try again.");
    console.error(err);
    return;
  }

  userDocRef = ref;
  photosCollectionRef = collection(db, "users", hash, "photos");
  localStorage.setItem(HASH_STORAGE_KEY, hash);

  if (unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = onSnapshot(ref, snap => {
    const data = snap.data();
    if (!data) return;
    steps = data.steps || [];
    checkins = data.checkins || [];
    intervalDays = data.intervalDays ?? 3;
    renderAll();
  });

  if (unsubscribePhotos) unsubscribePhotos();
  unsubscribePhotos = onSnapshot(photosCollectionRef, snap => {
    photos = {};
    snap.forEach(d => {
      const data = d.data();
      if (!data.date || !data.angle) return;
      if (!photos[data.date]) photos[data.date] = {};
      photos[data.date][data.angle] = data;
    });
    renderAll();
  });

  showApp();
}

document.getElementById("gate-unlock-btn").addEventListener("click", async () => {
  const passphrase = document.getElementById("gate-passphrase").value.trim();
  if (!passphrase) return;
  const hash = await hashPassphrase(passphrase);
  connect(hash);
});

document.getElementById("gate-passphrase").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("gate-unlock-btn").click();
});

document.getElementById("forget-device-btn").addEventListener("click", () => {
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  if (unsubscribePhotos) unsubscribePhotos();
  localStorage.removeItem(HASH_STORAGE_KEY);
  userDocRef = null;
  photosCollectionRef = null;
  steps = [];
  checkins = [];
  photos = {};
  document.getElementById("gate-passphrase").value = "";
  showGate("");
});

const savedHash = localStorage.getItem(HASH_STORAGE_KEY);
if (savedHash) connect(savedHash);
