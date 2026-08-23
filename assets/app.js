import { auth, db, googleProvider } from "./firebase.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const DATA_URLS = {
  students: "data/students.json",
  tests: "data/tests.json"
};

const TEACHER_EMAIL = "hachithanh2251999@gmail.com";
const STUDENT_EMAIL_DOMAIN = "pis-tests.local";

const state = {
  allStudents: [],
  students: [],
  tests: [],
  reports: [],
  selectedStudentId: null,
  activeTab: "reports",
  query: "",
  role: null,
  session: null,
  unsubscribeReports: null
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

function initials(fullName) {
  return fullName.trim().split(/\s+/).slice(-2).map(part => part[0]).join("").toUpperCase();
}

function validReport(report) {
  return Boolean(
    report &&
    typeof report.studentId === "string" &&
    typeof report.testId === "string" &&
    Number.isFinite(Number(report.score)) &&
    Number.isFinite(Number(report.maxScore)) &&
    Number(report.maxScore) > 0 &&
    !Number.isNaN(new Date(report.submittedAt).getTime())
  );
}

function studentReports(studentId) {
  return state.reports
    .filter(report => report.studentId === studentId && validReport(report))
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

function setSyncStatus(label, connected = true) {
  const status = el("sync-status");
  status.lastChild.textContent = ` ${label}`;
  status.classList.toggle("offline", !connected);
}

function renderStudentList() {
  const list = el("student-list");
  const queryText = normalizeText(state.query.trim());
  const filtered = state.students.filter(student =>
    normalizeText(`${student.fullName} ${student.nickname || ""}`).includes(queryText)
  );

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
  if (state.role === "student" && studentId !== state.session?.studentId) return;
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
  return `<div class="empty-state"><div><span class="empty-icon" aria-hidden="true">${icon}</span><h4>${title}</h4><p>${description}</p></div></div>`;
}

function renderReports(studentId) {
  const reports = studentReports(studentId);
  const container = el("reports-content");
  if (!reports.length) {
    container.innerHTML = emptyState("✓", "Chưa có báo cáo bài test", "Khi học sinh nộp bài, báo cáo sẽ tự động xuất hiện tại đây.");
    return;
  }

  container.innerHTML = `
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Bài test</th><th>Điểm</th><th>Tỉ lệ</th><th>Thời gian làm</th><th>Ngày nộp</th></tr></thead>
      <tbody>${reports.map(report => `<tr>
        <td><strong>${escapeHtml(testName(report.testId))}</strong></td>
        <td><span class="score-chip">${formatScore(report)}</span></td>
        <td>${percent(report)}%</td>
        <td>${formatDuration(report.durationSeconds)}</td>
        <td>${dateFormatter.format(new Date(report.submittedAt))}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
}

function renderTotals(studentId) {
  const reports = studentReports(studentId);
  const container = el("total-content");
  if (!reports.length) {
    container.innerHTML = emptyState("∑", "Chưa có điểm để tổng hợp", "Tab này tự tính kết quả tốt nhất của từng bài sau khi có bài nộp.");
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
    <div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Bài test</th><th>Điểm tốt nhất</th><th>Tỉ lệ</th><th>Số lần làm</th></tr></thead>
      <tbody>${bestReports.map(report => `<tr>
        <td><strong>${escapeHtml(testName(report.testId))}</strong></td>
        <td><span class="score-chip">${formatScore(report)}</span></td>
        <td>${percent(report)}%</td>
        <td>${reports.filter(item => item.testId === report.testId).length}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
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

function authMessage(error) {
  const code = error?.code || "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "Username hoặc mật khẩu chưa đúng.";
  if (code === "auth/too-many-requests") return "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau.";
  if (code === "auth/popup-closed-by-user") return "Cửa sổ Google đã đóng trước khi đăng nhập xong.";
  if (code === "auth/unauthorized-domain") return "Tên miền GitHub Pages chưa được cấp quyền trong Firebase.";
  return "Chưa thể đăng nhập. Vui lòng thử lại.";
}

async function handleStudentLogin(event) {
  event.preventDefault();
  const errorEl = el("student-login-error");
  const username = el("student-username").value.trim().toLowerCase();
  const password = el("student-password").value;
  if (!/^[a-z0-9._-]+$/.test(username)) {
    errorEl.textContent = "Username chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới.";
    return;
  }
  errorEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, `${username}@${STUDENT_EMAIL_DOMAIN}`, password);
  } catch (error) {
    errorEl.textContent = authMessage(error);
  }
}

async function handleTeacherLogin(event) {
  event.preventDefault();
  el("teacher-login-error").textContent = "";
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    el("teacher-login-error").textContent = authMessage(error);
  }
}

function bindAuth() {
  document.querySelectorAll("[data-login-tab]").forEach(button => button.addEventListener("click", () => setLoginTab(button.dataset.loginTab)));
  el("student-login-form").addEventListener("submit", handleStudentLogin);
  el("teacher-login-form").addEventListener("submit", handleTeacherLogin);
  el("logout-button").addEventListener("click", () => signOut(auth));
}

function showLogin() {
  state.unsubscribeReports?.();
  state.unsubscribeReports = null;
  state.session = null;
  state.role = null;
  state.reports = [];
  document.body.classList.remove("student-mode", "teacher-mode");
  el("app-shell").hidden = true;
  el("login-shell").hidden = false;
  history.replaceState(null, "", location.pathname);
}

function startReportListener(user) {
  state.unsubscribeReports?.();
  const reportsRef = collection(db, "reports");
  const reportsQuery = state.role === "teacher" ? reportsRef : query(reportsRef, where("uid", "==", user.uid));
  state.unsubscribeReports = onSnapshot(reportsQuery, snapshot => {
    state.reports = snapshot.docs.map(reportDoc => {
      const data = reportDoc.data();
      const submittedAt = data.submittedAt?.toDate ? data.submittedAt.toDate().toISOString() : data.submittedAt;
      return { id: reportDoc.id, ...data, submittedAt };
    });
    setSyncStatus("Đã đồng bộ Firebase", true);
    renderProfile();
  }, error => {
    console.error(error);
    setSyncStatus("Mất kết nối Firebase", false);
  });
}

function openApp(user, session) {
  state.session = session;
  state.role = session.role;
  document.body.classList.toggle("student-mode", session.role === "student");
  document.body.classList.toggle("teacher-mode", session.role === "teacher");
  el("login-shell").hidden = true;
  el("app-shell").hidden = false;
  state.students = [...state.allStudents];

  if (session.role === "student") {
    const student = state.allStudents.find(item => item.id === session.studentId);
    if (!student) throw new Error("Hồ sơ học sinh không tồn tại.");
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
  startReportListener(user);
}

async function resolveSession(user) {
  if (user.email?.toLowerCase() === TEACHER_EMAIL) return { role: "teacher" };
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!profileSnapshot.exists()) throw new Error("Tài khoản chưa được liên kết với hồ sơ học sinh.");
  const profile = profileSnapshot.data();
  if (profile.role !== "student" || !state.allStudents.some(student => student.id === profile.studentId)) {
    throw new Error("Hồ sơ học sinh chưa hợp lệ.");
  }
  return { role: "student", studentId: profile.studentId };
}

async function recordReport(payload) {
  if (state.role !== "student" || !state.session?.studentId || !auth.currentUser) {
    throw new Error("Học sinh cần đăng nhập trước khi nộp bài.");
  }
  const report = {
    uid: auth.currentUser.uid,
    studentId: state.session.studentId,
    testId: String(payload.testId || ""),
    score: Number(payload.score),
    maxScore: Number(payload.maxScore),
    durationSeconds: Number(payload.durationSeconds || 0),
    submittedAt: payload.submittedAt || new Date().toISOString(),
    createdAt: serverTimestamp(),
    details: payload.details || null
  };
  if (!validReport(report)) throw new Error("Dữ liệu kết quả chưa hợp lệ.");
  const result = await addDoc(collection(db, "reports"), report);
  return { id: result.id, ...report };
}

window.PISTracker = Object.freeze({
  recordReport,
  currentStudentId: () => state.session?.studentId || null
});

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được ${url}`);
  return response.json();
}

async function init() {
  bindAuth();
  bindTabs();
  el("student-search").addEventListener("input", event => {
    state.query = event.target.value;
    renderStudentList();
  });

  try {
    const [studentData, testData] = await Promise.all([loadJson(DATA_URLS.students), loadJson(DATA_URLS.tests)]);
    state.allStudents = [...studentData.students].sort((a, b) => collator.compare(a.fullName, b.fullName));
    state.tests = testData.tests || [];
    onAuthStateChanged(auth, async user => {
      if (!user) return showLogin();
      try {
        const session = await resolveSession(user);
        openApp(user, session);
      } catch (error) {
        console.error(error);
        await signOut(auth);
        el("student-login-error").textContent = error.message;
      }
    });
  } catch (error) {
    console.error(error);
    el("login-shell").hidden = true;
    el("app-shell").hidden = false;
    el("loading-state").hidden = true;
    el("error-state").hidden = false;
  }
}

init();
