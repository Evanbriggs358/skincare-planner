import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

function saveSteps(newSteps) {
  steps = newSteps;
  syncToCloud();
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeFrequency(freq) {
  if (freq.type === "daily") return "Every day";
  const days = freq.days.slice().sort().map(d => DAY_LABELS[d]);
  return days.length ? days.join(", ") : "No days selected";
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
      <div class="step-freq">${describeFrequency(step.frequency)}</div>
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

document.getElementById("add-step-btn").addEventListener("click", () => openStepForm(null));
document.getElementById("step-cancel-btn").addEventListener("click", closeStepForm);

document.querySelectorAll("input[name=freq-type]").forEach(radio => {
  radio.addEventListener("change", updateDayPickerVisibility);
});

function updateDayPickerVisibility() {
  const selected = document.querySelector("input[name=freq-type]:checked").value;
  dayPicker.classList.toggle("hidden", selected !== "days");
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

  updateDayPickerVisibility();
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
  } else {
    const days = Array.from(dayCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => Number(cb.value));
    frequency = { type: "days", days };
  }

  if (editingStepId) {
    const step = steps.find(s => s.id === editingStepId);
    step.time = time;
    step.product = product;
    step.frequency = frequency;
  } else {
    steps.push({
      id: crypto.randomUUID(),
      time,
      product,
      frequency
    });
  }

  saveSteps(steps);
  render();
  closeStepForm();
});

// ---- Calendar (day / week / month views) ----
let calendarView = "week";
let calendarDate = new Date();
calendarDate.setHours(0, 0, 0, 0);

function stepAppliesOnDay(step, dayOfWeek) {
  return step.frequency.type === "daily" || step.frequency.days.includes(dayOfWeek);
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
  const dayOfWeek = date.getDay();
  const morning = steps.filter(s => s.time === "morning" && stepAppliesOnDay(s, dayOfWeek));
  const evening = steps.filter(s => s.time === "evening" && stepAppliesOnDay(s, dayOfWeek));
  const isToday = isSameDay(date, today);

  return `
    <div class="day-card ${extraClass || ""} ${isToday ? "is-today" : ""}">
      <div class="day-card-header">
        <span>${extraClass ? formatDayHeadingLong(date) : formatDayHeading(date)}</span>
        ${isToday ? '<span class="today-tag">Today</span>' : ""}
      </div>
      <div class="day-section-label">Morning</div>
      ${renderDaySteps(morning)}
      <div class="day-section-label">Evening</div>
      ${renderDaySteps(evening)}
    </div>
  `;
}

function renderDayView(container) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  container.innerHTML = buildDayCardHtml(calendarDate, today, "day-view-card");
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
    const dayOfWeek = cellDate.getDay();
    const hasMorning = steps.some(s => s.time === "morning" && stepAppliesOnDay(s, dayOfWeek));
    const hasEvening = steps.some(s => s.time === "evening" && stepAppliesOnDay(s, dayOfWeek));

    cellsHtml += `
      <button type="button" class="month-cell ${inMonth ? "" : "is-outside"} ${isSameDay(cellDate, today) ? "is-today" : ""}" data-date="${cellDate.getTime()}">
        <span>${cellDate.getDate()}</span>
        <span class="month-cell-dots">
          ${hasMorning ? '<span class="dot dot-am"></span>' : ""}
          ${hasEvening ? '<span class="dot dot-pm"></span>' : ""}
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
  { key: "oiliness", label: "Oiliness", low: "None", high: "Severe" },
  { key: "improvement", label: "Overall improvement", low: "Much worse", high: "Much better" }
];

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
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
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

function renderCheckinList() {
  const list = document.getElementById("checkin-list");
  list.innerHTML = "";

  if (checkins.length === 0) {
    list.innerHTML = `<li class="empty-note">No check-ins logged yet.</li>`;
    return;
  }

  const sorted = [...checkins].sort((a, b) => b.date.localeCompare(a.date));
  sorted.forEach(c => {
    const li = document.createElement("li");
    li.className = "checkin-item";
    const values = QUESTIONS.map(q => `${q.label}: ${c[q.key]}/5`).join(" · ");
    li.innerHTML = `
      <div class="checkin-date">${c.date}</div>
      <div class="checkin-values">${values}</div>
    `;
    list.appendChild(li);
  });
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
  renderCheckinList();
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
    morning.forEach(s => lines.push(`- ${s.product} (${describeFrequency(s.frequency)})`));
  }
  lines.push("");

  lines.push("EVENING");
  const evening = steps.filter(s => s.time === "evening");
  if (evening.length === 0) {
    lines.push("(none)");
  } else {
    evening.forEach(s => lines.push(`- ${s.product} (${describeFrequency(s.frequency)})`));
  }
  lines.push("");

  lines.push("CHECK-IN HISTORY");
  if (checkins.length === 0) {
    lines.push("(none)");
  } else {
    const sorted = [...checkins].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach(c => {
      const values = QUESTIONS.map(q => `${q.label} ${c[q.key]}/5`).join(", ");
      lines.push(`${c.date}: ${values}`);
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

function renderAll() {
  render();
  renderCheckinStatus();
  renderCheckinList();
  document.getElementById("interval-input").value = intervalDays;
  const calendarTabActive = document.querySelector('.tab-btn[data-tab="calendar"]').classList.contains("active");
  if (calendarTabActive) renderCalendar();
}

// ---- Cloud connection & passphrase gate ----
const HASH_STORAGE_KEY = "skincare-user-hash";
let userDocRef = null;
let unsubscribeSnapshot = null;

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
  localStorage.removeItem(HASH_STORAGE_KEY);
  userDocRef = null;
  steps = [];
  checkins = [];
  document.getElementById("gate-passphrase").value = "";
  showGate("");
});

const savedHash = localStorage.getItem(HASH_STORAGE_KEY);
if (savedHash) connect(savedHash);
