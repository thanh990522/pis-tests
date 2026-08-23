const DATA_URLS = {
  students: "data/students.json",
  tests: "data/tests.json",
  reports: "data/reports.json"
};

const STORAGE_KEYS = {
  session: "pis_session_v1",
  localReports: "pis_local_reports_v1",
  importedReports: "pis_imported_reports_v1"
};

const state = {
  allStudents: [],
  students: [],
  tests: [],
  staticReports: [],
  reports: [],
  selectedStudentId: null,
  activeTab: "reports",
  query: "",
  role: null,
  session: null
};

const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
const dateFormatter = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
const el = id => document.getElementById(id);

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readLocalArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function validReport(report) {
  return Boolean(
    report &&
    typeof report === "object" &&
    typeof report.studentId === "string" &&
    typeof report.testId === "string" &&
    Number.isFinite(Number(report.score)) &&
    Number.isFinite(Number(report.maxScore)) &&
    Number(report.maxScore) > 0 &&
    !Number.isNaN(new Date(report.submittedAt).getTime())
  );
}

function uniqueReports(reports) {
  const map = new Map();
  reports.filter(validReport).forEach(report => {
    const key = report.id || [report.studentId, report.testId, report.submittedAt, report.score, report.maxScore].join("|");
    map.set(key, { ...report, id: report.id || key });
  });
  return [...map.values()];
}

function refreshReports() {
  state.reports = uniqueReports([
    ...state.staticReports,
    ...readLocalArray(STORAGE_KEYS.localReports),
    ...readLocalArray(STORAGE_KEYS.importedReports)
  ]);
}

function initials(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return parts.slice(-2).map(part => part[0]).join("").toUpperCase();
}

function studentReports(studentId) {
  return state.reports
    .filter(report => report.studentId === studentId)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function testName(testId) {
  return state.tests.find(test => test.id === testId)?.title || "Bài test chưa đặt tên";
}

function percent(report) {
  return Math.round((Number(report.score) / Number(report.maxScore)) * 100);
}

function formatScore(report) {
  return `${Number(report.score).toLocaleString("vi-VN")}/${Number(report.maxScore).toLocaleString("vi-VN")}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return "—";
  const minutes = Math.floor(Number(seconds) / 60);
  const remaining = Number(seconds) % 60;
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
}

function statsFor(studentId) {
  const reports = studentReports(studentId);
  if (!reports.length) return { count: 0, average: null, best: null };
  const percentages = reports.map(percent);
  return {
    count: new Set(reports.map(report => report.testId)).size,
    average: Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length),
    best: Math.max(...percentages)
  };
}

function renderStudentList() {
  const list = el("student-list");
  const query = normalizeText(state.query.trim());
  const filtered = state.students.filter(student => {
    const haystack = normalizeText(`${student.fullName} ${student.nickname || ""}`);
    return haystack.includes(query);
  });

  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "no-search-results";
    empty.textContent = "Không tìm thấy học sinh phù hợp.";
    list.append(empty);
    return;
  }

  filtered.forEach(student => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `student-button${student.id === state.selectedStudentId ? " active" : ""}`;
    button.dataset.studentId = student.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(student.id === state.selectedStudentId));
    button.innerHTML = `
      <span class="mini-avatar" aria-hidden="true">${initials(student.fullName)}</span>
      <span class="student-name">
        <strong>${escapeHtml(student.fullName)}</strong>
        <small>${student.nickname ? `Nickname: ${escapeHtml(student.nickname)}` : "Chưa có nickname"}</small>
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    `;
    button.addEventListener("click", () => selectStudent(student.id));
    list.append(button);
  });
}

function selectStudent(studentId) {
  if (state.role === "student" && studentId !== state.session.studentId) return;
  state.selectedStudentId = studentId;
  renderStudentList();
  renderProfile();
  history.replaceState(null, "", `#student=${encodeURIComponent(studentId)}`);
}

function renderProfile() {
  const student = state.allStudents.find(item => item.id === state.selectedStudentId);
  if (!student) return;

  const stats = statsFor(student.id);
  el("profile-avatar").textContent = initials(student.fullName);
  el("profile-name").textContent = student.fullName;
  el("profile-nickname").textContent = student.nickname ? `Nickname: ${student.nickname}` : "Chưa có nickname";
  el("profile-tests").textContent = stats.count;
  el("profile-average").textContent = stats.average === null ? "—" : `${stats.average}%`;
  el("profile-best").textContent = stats.best === null ? "—" : `${stats.best}%`;
  renderReports(student.id);
  renderTotals(student.id);
}

function emptyState(icon, title, description) {
  return `
    <div class="empty-state">
      <div>
        <span class="empty-icon" aria-hidden="true">${icon}</span>
        <h4>${title}</h4>
        <p>${description}</p>
      </div>
    </div>
  `;
}

function renderReports(studentId) {
  const reports = studentReports(studentId);
  const container = el("reports-content");
  if (!reports.length) {
    container.innerHTML = emptyState("✓", "Chưa có báo cáo bài test", "Hồ sơ đã sẵn sàng. Khi một bài test được tạo và học sinh nộp bài, báo cáo chi tiết sẽ xuất hiện tại đây.");
    return;
  }

  container.innerHTML = `
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr><th>Bài test</th><th>Điểm</th><th>Tỉ lệ</th><th>Thời gian làm</th><th>Ngày nộp</th></tr></thead>
        <tbody>${reports.map(report => `
          <tr>
            <td><strong>${escapeHtml(testName(report.testId))}</strong></td>
            <td><span class="score-chip">${formatScore(report)}</span></td>
            <td>${percent(report)}%</td>
            <td>${formatDuration(report.durationSeconds)}</td>
            <td>${dateFormatter.format(new Date(report.submittedAt))}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderTotals(studentId) {
  const reports = studentReports(studentId);
  const container = el("total-content");
  if (!reports.length) {
    container.innerHTML = emptyState("∑", "Chưa có điểm để tổng hợp", "Tab này sẽ tự động tính số bài đã hoàn thành, điểm trung bình và kết quả cao nhất sau khi có dữ liệu bài test.");
    return;
  }

  const bestByTest = new Map();
  reports.forEach(report => {
    const current = bestByTest.get(report.testId);
    if (!current || percent(report) > percent(current)) bestByTest.set(report.testId, report);
  });
  const bestReports = [...bestByTest.values()];
  const average = Math.round(bestReports.reduce((sum, report) => sum + percent(report), 0) / bestReports.length);
  const totalScore = bestReports.reduce((sum, report) => sum + Number(report.score), 0);
  const totalMax = bestReports.reduce((sum, report) => sum + Number(report.maxScore), 0);

  container.innerHTML = `
    <div class="total-summary">
      <div class="summary-card"><span>Bài đã hoàn thành</span><strong>${bestReports.length}</strong></div>
      <div class="summary-card"><span>Điểm trung bình</span><strong>${average}%</strong></div>
      <div class="summary-card"><span>Tổng điểm tốt nhất</span><strong>${totalScore}/${totalMax}</strong></div>
    </div>
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr><th>Bài test</th><th>Điểm tốt nhất</th><th>Tỉ lệ</th><th>Số lần làm</th></tr></thead>
        <tbody>${bestReports.map(report => `
          <tr>
            <td><strong>${escapeHtml(testName(report.testId))}</strong></td>
            <td><span class="score-chip">${formatScore(report)}</span></td>
            <td>${percent(report)}%</td>
            <td>${reports.filter(item => item.testId === report.testId).length}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach(tab => {
        const active = tab.dataset.tab === state.activeTab;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      el("reports-panel").hidden = state.activeTab !== "reports";
      el("total-panel").hidden = state.activeTab !== "total";
    });
  });
}

function setLoginTab(tabName) {
  document.querySelectorAll("[data-login-tab]").forEach(button => {
    const active = button.dataset.loginTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  el("student-login-form").hidden = tabName !== "student";
  el("teacher-login-form").hidden = tabName !== "teacher";
}

function handleStudentLogin(event) {
  event.preventDefault();
  const error = el("student-login-error");
  const profileCode = el("student-username").value.trim().toLowerCase();
  const student = state.allStudents.find(item => item.id.toLowerCase() === profileCode);
  if (!student) {
    error.textContent = "Mã hồ sơ chưa đúng. Ví dụ: pis-001.";
    return;
  }
  error.textContent = "";
  startSession({ role: "student", studentId: student.id });
}

function handleTeacherLogin(event) {
  event.preventDefault();
  startSession({ role: "teacher" });
}

function bindAuth() {
  document.querySelectorAll("[data-login-tab]").forEach(button => button.addEventListener("click", () => setLoginTab(button.dataset.loginTab)));
  el("student-login-form").addEventListener("submit", handleStudentLogin);
  el("teacher-login-form").addEventListener("submit", handleTeacherLogin);
  el("logout-button").addEventListener("click", logout);
}

function startSession(session) {
  state.session = session;
  state.role = session.role;
  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  document.body.classList.toggle("student-mode", session.role === "student");
  document.body.classList.toggle("teacher-mode", session.role === "teacher");
  el("login-shell").hidden = true;
  el("app-shell").hidden = false;

  state.students = [...state.allStudents].sort((a, b) => collator.compare(a.fullName, b.fullName));
  if (session.role === "student") {
    const student = state.allStudents.find(item => item.id === session.studentId);
    if (!student) return logout();
    state.selectedStudentId = student.id;
    el("session-label").textContent = student.nickname || student.fullName;
    el("student-count").textContent = "1";
    el("hero-student-count").textContent = "1";
  } else {
    const requestedId = new URLSearchParams(location.hash.replace(/^#/, "")).get("student");
    state.selectedStudentId = state.students.some(student => student.id === requestedId) ? requestedId : state.students[0]?.id || null;
    el("session-label").textContent = "Giáo viên: Mr. Hà Chí Thanh";
    el("student-count").textContent = state.students.length;
    el("hero-student-count").textContent = state.students.length;
  }
  renderStudentList();
  renderProfile();
  el("loading-state").hidden = true;
  el("profile-content").hidden = false;
}

function logout() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
  state.session = null;
  state.role = null;
  document.body.classList.remove("student-mode", "teacher-mode");
  el("app-shell").hidden = true;
  el("login-shell").hidden = false;
  history.replaceState(null, "", location.pathname);
}

function restoreSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.session) || "null");
    if (session?.role === "teacher") return startSession(session);
    if (session?.role === "student" && state.allStudents.some(student => student.id === session.studentId)) return startSession(session);
  } catch {}
  logout();
}

function encodeSubmission(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeSubmission(value) {
  const binary = atob(value.trim());
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function submissionPayload(studentId) {
  return {
    schema: "pis-tests-submission-v1",
    studentId,
    exportedAt: new Date().toISOString(),
    reports: studentReports(studentId)
  };
}

function reportsFromPayload(payload) {
  if (Array.isArray(payload)) return payload.filter(validReport);
  if (payload?.schema === "pis-tests-submission-v1" && Array.isArray(payload.reports)) {
    return payload.reports.filter(report => validReport(report) && report.studentId === payload.studentId);
  }
  if (validReport(payload)) return [payload];
  return [];
}

function saveImportedReports(reports) {
  const merged = uniqueReports([...readLocalArray(STORAGE_KEYS.importedReports), ...reports]);
  localStorage.setItem(STORAGE_KEYS.importedReports, JSON.stringify(merged));
  refreshReports();
  renderProfile();
  el("import-status").textContent = `Đã lưu ${merged.length} báo cáo được nhập trên thiết bị này.`;
}

function bindHandoff() {
  el("make-code-button").addEventListener("click", () => {
    const payload = submissionPayload(state.session.studentId);
    el("submission-code").value = encodeSubmission(payload);
    el("submission-code-box").hidden = false;
  });

  el("copy-code-button").addEventListener("click", async () => {
    const textarea = el("submission-code");
    try {
      await navigator.clipboard.writeText(textarea.value);
      el("copy-code-button").textContent = "Đã sao chép";
      setTimeout(() => { el("copy-code-button").textContent = "Sao chép mã"; }, 1500);
    } catch {
      textarea.select();
      document.execCommand("copy");
    }
  });

  el("download-results-button").addEventListener("click", () => {
    const payload = submissionPayload(state.session.studentId);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    link.download = `PIS_${state.session.studentId}_ket-qua.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  el("import-code-button").addEventListener("click", () => {
    const codes = el("result-code-input").value.split(/\s+/).filter(Boolean);
    const reports = [];
    codes.forEach(code => {
      try { reports.push(...reportsFromPayload(decodeSubmission(code))); } catch {}
    });
    if (!reports.length) {
      el("import-status").textContent = "Không đọc được báo cáo hợp lệ nào từ mã đã nhập.";
      return;
    }
    saveImportedReports(reports);
    el("result-code-input").value = "";
  });

  el("result-file-input").addEventListener("change", async event => {
    const reports = [];
    for (const file of event.target.files) {
      try { reports.push(...reportsFromPayload(JSON.parse(await file.text()))); } catch {}
    }
    if (reports.length) saveImportedReports(reports);
    else el("import-status").textContent = "Không tìm thấy báo cáo hợp lệ trong file.";
    event.target.value = "";
  });

  el("clear-imported-button").addEventListener("click", () => {
    if (!confirm("Xóa toàn bộ kết quả đã nhập trên thiết bị này?")) return;
    localStorage.removeItem(STORAGE_KEYS.importedReports);
    refreshReports();
    renderProfile();
    el("import-status").textContent = "Đã xóa dữ liệu nhập trên thiết bị này.";
  });
}

function recordReport(payload) {
  if (state.role !== "student" || !state.session?.studentId) throw new Error("Học sinh cần đăng nhập trước khi nộp bài.");
  const report = {
    id: payload.id || `${state.session.studentId}-${payload.testId}-${Date.now()}`,
    studentId: state.session.studentId,
    testId: String(payload.testId || ""),
    score: Number(payload.score),
    maxScore: Number(payload.maxScore),
    durationSeconds: Number(payload.durationSeconds || 0),
    submittedAt: payload.submittedAt || new Date().toISOString(),
    details: payload.details || null
  };
  if (!validReport(report)) throw new Error("Dữ liệu kết quả chưa hợp lệ.");
  const merged = uniqueReports([...readLocalArray(STORAGE_KEYS.localReports), report]);
  localStorage.setItem(STORAGE_KEYS.localReports, JSON.stringify(merged));
  refreshReports();
  renderProfile();
  return report;
}

window.PISTracker = Object.freeze({ recordReport, currentStudentId: () => state.session?.studentId || null });

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được ${url}`);
  return response.json();
}

async function init() {
  bindAuth();
  bindTabs();
  bindHandoff();
  el("student-search").addEventListener("input", event => {
    state.query = event.target.value;
    renderStudentList();
  });

  try {
    const [studentData, testData, reportData] = await Promise.all([
      loadJson(DATA_URLS.students),
      loadJson(DATA_URLS.tests),
      loadJson(DATA_URLS.reports)
    ]);
    state.allStudents = [...studentData.students].sort((a, b) => collator.compare(a.fullName, b.fullName));
    state.tests = testData.tests || [];
    state.staticReports = reportData.reports || [];
    refreshReports();
    restoreSession();
  } catch (error) {
    console.error(error);
    el("login-shell").hidden = true;
    el("app-shell").hidden = false;
    el("loading-state").hidden = true;
    el("error-state").hidden = false;
  }
}

init();
