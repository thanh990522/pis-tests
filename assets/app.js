const DATA_URLS = {
  students: "data/students.json",
  tests: "data/tests.json",
  reports: "data/reports.json"
};

const state = {
  students: [],
  tests: [],
  reports: [],
  selectedStudentId: null,
  activeTab: "reports",
  query: ""
};

const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short"
});

const el = id => document.getElementById(id);

function normalizeText(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
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
  if (!report.maxScore) return 0;
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
  state.selectedStudentId = studentId;
  renderStudentList();
  renderProfile();
  history.replaceState(null, "", `#student=${encodeURIComponent(studentId)}`);
}

function renderProfile() {
  const student = state.students.find(item => item.id === state.selectedStudentId);
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
    container.innerHTML = emptyState(
      "✓",
      "Chưa có báo cáo bài test",
      "Hồ sơ đã sẵn sàng. Khi một bài test được tạo và học sinh nộp bài, báo cáo chi tiết sẽ xuất hiện tại đây."
    );
    return;
  }

  container.innerHTML = `
    <div class="report-table-wrap">
      <table class="report-table">
        <thead><tr><th>Bài test</th><th>Điểm</th><th>Tỉ lệ</th><th>Thời gian làm</th><th>Ngày nộp</th></tr></thead>
        <tbody>
          ${reports.map(report => `
            <tr>
              <td><strong>${escapeHtml(testName(report.testId))}</strong></td>
              <td><span class="score-chip">${formatScore(report)}</span></td>
              <td>${percent(report)}%</td>
              <td>${formatDuration(report.durationSeconds)}</td>
              <td>${dateFormatter.format(new Date(report.submittedAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTotals(studentId) {
  const reports = studentReports(studentId);
  const container = el("total-content");
  if (!reports.length) {
    container.innerHTML = emptyState(
      "∑",
      "Chưa có điểm để tổng hợp",
      "Tab này sẽ tự động tính số bài đã hoàn thành, điểm trung bình và kết quả cao nhất sau khi có dữ liệu bài test."
    );
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
        <tbody>
          ${bestReports.map(report => `
            <tr>
              <td><strong>${escapeHtml(testName(report.testId))}</strong></td>
              <td><span class="score-chip">${formatScore(report)}</span></td>
              <td>${percent(report)}%</td>
              <td>${reports.filter(item => item.testId === report.testId).length}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được ${url}`);
  return response.json();
}

async function init() {
  bindTabs();
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

    state.students = [...studentData.students].sort((a, b) => collator.compare(a.fullName, b.fullName));
    state.tests = testData.tests || [];
    state.reports = reportData.reports || [];

    const requestedId = new URLSearchParams(location.hash.replace(/^#/, "")).get("student");
    state.selectedStudentId = state.students.some(student => student.id === requestedId)
      ? requestedId
      : state.students[0]?.id || null;

    el("student-count").textContent = state.students.length;
    el("hero-student-count").textContent = state.students.length;
    renderStudentList();
    renderProfile();

    el("loading-state").hidden = true;
    el("profile-content").hidden = false;
  } catch (error) {
    console.error(error);
    el("loading-state").hidden = true;
    el("error-state").hidden = false;
  }
}

init();
