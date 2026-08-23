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
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const DATA_URLS = {
  students: "data/students.json",
  tests: "data/tests.json",
  featuredTest: "data/unit-1-1-vocab.json",
  featuredSolutions: "data/unit-1-1-vocab-solutions.json"
};
const TEACHER_EMAIL = "hachithanh2251999@gmail.com";
const STUDENT_EMAIL_DOMAIN = "pis-tests.local";
const FEATURED_TEST_ID = "unit-1-1-vocab";

const state = {
  allStudents: [], students: [], tests: [], reports: [], sessions: [],
  userProfiles: new Map(), selectedStudentId: null, selectedReportId: null,
  activeTab: "reports", query: "", role: null, session: null,
  release: { released: false }, teacherReview: null,
  unsubscribeReports: null, unsubscribeRelease: null,
  unsubscribeProfiles: null, unsubscribeSessions: null, dashboardTicker: null
};

const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const el = id => document.getElementById(id);

function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function initials(fullName) {
  return fullName.trim().split(/\s+/).slice(-2).map(part => part[0]).join("").toUpperCase();
}

function validReport(report) {
  return Boolean(report && typeof report.studentId === "string" && typeof report.testId === "string" && Number.isFinite(Number(report.score)) && Number.isFinite(Number(report.maxScore)) && Number(report.maxScore) > 0 && !Number.isNaN(new Date(report.submittedAt).getTime()));
}

function studentReports(studentId) {
  return state.reports.filter(report => report.studentId === studentId && validReport(report)).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function studentSessions(studentId) {
  return state.sessions.filter(session => session.studentId === studentId).sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
}

function testName(testId) {
  return state.tests.find(test => test.id === testId)?.title || "Untitled test";
}

function percent(report) { return Math.round((Number(report.score) / Number(report.maxScore)) * 100); }
function formatScore(report) { return `${Number(report.score).toLocaleString("en-GB")}/${Number(report.maxScore).toLocaleString("en-GB")}`; }
function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return "—";
  const minutes = Math.floor(Number(seconds) / 60);
  const remaining = Math.max(0, Math.floor(Number(seconds) % 60));
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
}

function timestampToIso(value) {
  if (value?.toDate) return value.toDate().toISOString();
  return value || null;
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

function refreshStudents() {
  const merged = state.allStudents.map(student => {
    const profile = state.userProfiles.get(student.id);
    return {
      ...student,
      ...(profile ? { fullName: profile.fullName || student.fullName, nickname: profile.nickname || null, uid: profile.uid } : {})
    };
  }).sort((a, b) => collator.compare(a.fullName, b.fullName));
  state.students = state.role === "student" ? merged.filter(student => student.id === state.session?.studentId) : merged;
  el("student-count").textContent = state.students.length;
  el("hero-student-count").textContent = state.students.length;
  renderStudentList();
  renderProfile();
}

function renderStudentList() {
  const list = el("student-list");
  const queryText = normalizeText(state.query.trim());
  const filtered = state.students.filter(student => normalizeText(`${student.fullName} ${student.nickname || ""}`).includes(queryText));
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "no-search-results";
    empty.textContent = "No matching student found.";
    list.append(empty);
    return;
  }
  filtered.forEach(student => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `student-button${student.id === state.selectedStudentId ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(student.id === state.selectedStudentId));
    button.innerHTML = `<span class="mini-avatar" aria-hidden="true">${initials(student.fullName)}</span><span class="student-name"><strong>${escapeHtml(student.fullName)}</strong><small>${student.nickname ? `Nickname: ${escapeHtml(student.nickname)}` : "No nickname"}</small></span><span class="chevron" aria-hidden="true">›</span>`;
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
  const student = state.students.find(item => item.id === state.selectedStudentId);
  if (!student) return;
  const stats = statsFor(student.id);
  el("profile-avatar").textContent = initials(student.fullName);
  el("profile-name").textContent = student.fullName;
  el("profile-nickname").textContent = student.nickname ? `Nickname: ${student.nickname}` : "No nickname";
  el("profile-tests").textContent = stats.count;
  el("profile-average").textContent = stats.average === null ? "—" : `${stats.average}%`;
  el("profile-best").textContent = stats.best === null ? "—" : `${stats.best}%`;
  el("edit-profile-button").disabled = !student.uid;
  renderAvailableTests(student.id);
  renderReports(student.id);
  renderTotals(student.id);
  renderProctorStatus(student.id);
}

function emptyState(icon, title, description) {
  return `<div class="empty-state"><div><span class="empty-icon" aria-hidden="true">${icon}</span><h4>${title}</h4><p>${description}</p></div></div>`;
}

function renderAvailableTests(studentId) {
  const container = el("available-tests");
  if (!container) return;
  if (!state.tests.length) {
    container.innerHTML = emptyState("✦", "No tests are available", "Your teacher will publish a test here.");
    return;
  }
  const reports = studentReports(studentId);
  const sessions = studentSessions(studentId);
  container.innerHTML = state.tests.map(test => {
    const report = reports.find(item => item.testId === test.id);
    const activeSession = sessions.find(item => item.testId === test.id && item.status === "in_progress");
    const actionLabel = report ? "View result" : activeSession ? "Resume test" : "Start test";
    const status = report ? `Submitted · ${formatScore(report)}` : activeSession ? "In progress · timer running" : "Available now";
    return `<article class="test-card">
      <div class="test-card-icon" aria-hidden="true">Aa</div>
      <div class="test-card-copy"><span class="test-status ${report ? "complete" : "available"}">${status}</span><h4>${escapeHtml(test.title)}</h4><p>${escapeHtml(test.description)}</p><small>${test.questions} questions · ${test.points} points · 10 minutes · One attempt</small></div>
      <a class="test-action" href="${escapeHtml(test.path)}">${actionLabel} <span>→</span></a>
    </article>`;
  }).join("");
}

function reportExitCount(report) {
  const session = state.sessions.find(item => item.testId === report.testId && item.uid === report.uid);
  return Math.max(Number(report.details?.exitCount || 0), Number(session?.exitCount || 0));
}

function renderReports(studentId) {
  const reports = studentReports(studentId);
  const container = el("reports-content");
  if (!reports.length) {
    container.innerHTML = emptyState("✓", "No test reports yet", "A new report will appear here automatically after the student submits a test.");
    return;
  }
  const actionHeader = state.role === "teacher" ? "<th>Review</th>" : "";
  container.innerHTML = `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Test</th><th>Score</th><th>Percentage</th><th>Time spent</th><th>Fullscreen exits</th><th>Submitted</th>${actionHeader}</tr></thead><tbody>${reports.map(report => `<tr><td><strong>${escapeHtml(testName(report.testId))}</strong></td><td><span class="score-chip">${formatScore(report)}</span></td><td>${percent(report)}%</td><td>${formatDuration(report.durationSeconds)}</td><td><span class="exit-chip ${reportExitCount(report) ? "warning" : ""}">${reportExitCount(report)}</span></td><td>${dateFormatter.format(new Date(report.submittedAt))}</td>${state.role === "teacher" ? `<td><button class="table-action" type="button" data-report-id="${escapeHtml(report.id)}">View details</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  container.querySelectorAll("[data-report-id]").forEach(button => button.addEventListener("click", () => openReportDetail(button.dataset.reportId)));
}

function renderTotals(studentId) {
  const reports = studentReports(studentId);
  const container = el("total-content");
  if (!reports.length) {
    container.innerHTML = emptyState("∑", "No scores to summarize", "This tab calculates the best score for each completed test.");
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
  container.innerHTML = `<div class="total-summary"><div class="summary-card"><span>Tests completed</span><strong>${bestReports.length}</strong></div><div class="summary-card"><span>Average score</span><strong>${average}%</strong></div><div class="summary-card"><span>Total best score</span><strong>${totalScore}/${totalMax}</strong></div></div><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Test</th><th>Best score</th><th>Percentage</th><th>Attempts</th></tr></thead><tbody>${bestReports.map(report => `<tr><td><strong>${escapeHtml(testName(report.testId))}</strong></td><td><span class="score-chip">${formatScore(report)}</span></td><td>${percent(report)}%</td><td>${reports.filter(item => item.testId === report.testId).length}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderProctorStatus(studentId) {
  const session = studentSessions(studentId)[0];
  const title = el("proctor-status-title");
  const copy = el("proctor-status-content");
  const card = el("proctor-status-card");
  if (!session) {
    title.textContent = "No active test session";
    copy.textContent = "When this student starts a test, the timer and fullscreen exits will appear here.";
    card.classList.remove("active", "warning");
    return;
  }
  const deadline = new Date(session.deadlineAt).getTime();
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const active = session.status === "in_progress";
  title.textContent = active ? `${testName(session.testId)} · in progress` : `${testName(session.testId)} · submitted`;
  copy.textContent = `${active ? `Time remaining: ${formatDuration(remaining)}.` : "Session completed."} Fullscreen/tab exits recorded: ${Number(session.exitCount || 0)}.`;
  card.classList.toggle("active", active);
  card.classList.toggle("warning", Number(session.exitCount || 0) > 0);
}

function renderReleaseControl() {
  const released = state.release.released === true;
  el("release-status").textContent = released ? "Answers and explanations are open for students who submitted this test." : "Answers are locked. Students can see their score only.";
  el("release-toggle").textContent = released ? "Lock explanations" : "Release explanations";
  el("release-toggle").setAttribute("aria-pressed", String(released));
  document.querySelector(".release-card")?.classList.toggle("released", released);
}

async function toggleRelease() {
  if (state.role !== "teacher" || !auth.currentUser) return;
  const button = el("release-toggle");
  button.disabled = true;
  try {
    await setDoc(doc(db, "testReleases", FEATURED_TEST_ID), {
      testId: FEATURED_TEST_ID,
      released: !state.release.released,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    }, { merge: true });
  } catch (error) {
    console.error(error);
    el("release-status").textContent = "The release setting could not be changed. Please try again.";
  } finally {
    button.disabled = false;
  }
}

function base64Bytes(value) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function decryptSolutions(payload, encodedKey) {
  const key = await crypto.subtle.importKey("raw", base64Bytes(encodedKey), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(payload.iv), tagLength: 128 }, key, base64Bytes(payload.ciphertext));
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function ensureTeacherReview() {
  if (state.teacherReview) return state.teacherReview;
  const [testResponse, solutionResponse, unlockSnapshot] = await Promise.all([
    fetch(DATA_URLS.featuredTest, { cache: "no-store" }),
    fetch(DATA_URLS.featuredSolutions, { cache: "no-store" }),
    getDoc(doc(db, "testUnlocks", FEATURED_TEST_ID))
  ]);
  if (!testResponse.ok || !solutionResponse.ok || !unlockSnapshot.exists()) throw new Error("The protected answer review could not be loaded.");
  const test = await testResponse.json();
  const solutions = await decryptSolutions(await solutionResponse.json(), unlockSnapshot.data().key);
  state.teacherReview = { questions: test.sections.flatMap(section => section.questions), solutions: solutions.answers };
  return state.teacherReview;
}

async function openReportDetail(reportId) {
  if (state.role !== "teacher") return;
  const report = state.reports.find(item => item.id === reportId);
  if (!report) return;
  state.selectedReportId = reportId;
  const student = state.students.find(item => item.id === report.studentId);
  el("report-detail-title").textContent = `${testName(report.testId)} · ${student?.fullName || report.studentId}`;
  el("report-detail-summary").innerHTML = `<div class="detail-summary"><div><span>Score</span><strong>${formatScore(report)} · ${percent(report)}%</strong></div><div><span>Time spent</span><strong>${formatDuration(report.durationSeconds)}</strong></div><div><span>Fullscreen exits</span><strong>${reportExitCount(report)}</strong></div><div><span>Submission</span><strong>${report.details?.autoSubmitted ? "Automatic at time limit" : "Submitted by student"}</strong></div></div>`;
  el("report-detail-questions").innerHTML = "<p class=\"detail-loading\">Loading the protected answer review…</p>";
  el("report-detail-error").textContent = "";
  el("report-detail-dialog").showModal();
  try {
    if (report.testId !== FEATURED_TEST_ID) throw new Error("Question-level review is not available for this test yet.");
    const review = await ensureTeacherReview();
    const answers = report.details?.answers || [];
    el("report-detail-questions").innerHTML = review.solutions.map((solution, index) => {
      const question = review.questions[index];
      const answerIndex = Number.isInteger(answers[index]) ? answers[index] : -1;
      const correct = answerIndex === solution.correctIndex;
      const chosen = answerIndex >= 0 ? question.options[answerIndex] : "No answer";
      return `<article class="detail-question ${correct ? "correct" : "incorrect"}"><header><span>Question ${index + 1}</span><strong>${correct ? "Correct" : "Incorrect"}</strong></header><h3>${escapeHtml(question.prompt)}</h3><p><b>Student answer:</b> ${escapeHtml(chosen)}</p><p><b>Correct answer:</b> ${escapeHtml(solution.answer)}</p><p class="detail-explanation">${escapeHtml(solution.explanation)}</p></article>`;
    }).join("");
  } catch (error) {
    console.error(error);
    el("report-detail-questions").innerHTML = `<p class="detail-loading">${escapeHtml(error.message)}</p>`;
  }
}

async function deleteSelectedAttempt() {
  const report = state.reports.find(item => item.id === state.selectedReportId);
  if (!report || state.role !== "teacher") return;
  const student = state.students.find(item => item.id === report.studentId);
  if (!confirm(`Delete this test attempt for ${student?.fullName || report.studentId}? The student will be able to take the test again.`)) return;
  const button = el("delete-attempt-button");
  button.disabled = true;
  el("report-detail-error").textContent = "";
  try {
    await Promise.all([
      deleteDoc(doc(db, "reports", report.id)),
      deleteDoc(doc(db, "testSessions", `${report.testId}_${report.uid}`))
    ]);
    el("report-detail-dialog").close();
    state.selectedReportId = null;
  } catch (error) {
    console.error(error);
    el("report-detail-error").textContent = "The attempt could not be deleted. Please try again.";
  } finally {
    button.disabled = false;
  }
}

function openEditProfile() {
  const student = state.students.find(item => item.id === state.selectedStudentId);
  if (!student?.uid || state.role !== "teacher") return;
  el("edit-full-name").value = student.fullName;
  el("edit-nickname").value = student.nickname || "";
  el("edit-profile-error").textContent = "";
  el("edit-profile-dialog").showModal();
}

async function handleEditProfile(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    el("edit-profile-dialog").close();
    return;
  }
  const student = state.students.find(item => item.id === state.selectedStudentId);
  const fullName = el("edit-full-name").value.trim();
  const nickname = el("edit-nickname").value.trim();
  if (!student?.uid || !fullName) return;
  const button = el("save-profile-button");
  button.disabled = true;
  el("edit-profile-error").textContent = "";
  try {
    await setDoc(doc(db, "users", student.uid), {
      fullName,
      nickname,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.email
    }, { merge: true });
    el("edit-profile-dialog").close();
  } catch (error) {
    console.error(error);
    el("edit-profile-error").textContent = "The profile could not be saved. Please try again.";
  } finally {
    button.disabled = false;
  }
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => {
    state.activeTab = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach(tab => {
      const active = tab.dataset.tab === state.activeTab;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    el("reports-panel").hidden = state.activeTab !== "reports";
    el("total-panel").hidden = state.activeTab !== "total";
  }));
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
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "The username or password is incorrect.";
  if (code === "auth/too-many-requests") return "Too many unsuccessful attempts. Please try again later.";
  if (code === "auth/popup-closed-by-user") return "The Google sign-in window was closed too early.";
  if (code === "auth/unauthorized-domain") return "This website has not been authorized in Firebase.";
  return "Sign-in is not available right now. Please try again.";
}

async function handleStudentLogin(event) {
  event.preventDefault();
  const errorEl = el("student-login-error");
  const username = el("student-username").value.trim().toLowerCase();
  const password = el("student-password").value;
  if (!/^[a-z0-9._-]+$/.test(username)) {
    errorEl.textContent = "Use lowercase letters, numbers, dots, hyphens, or underscores only.";
    return;
  }
  errorEl.textContent = "";
  try { await signInWithEmailAndPassword(auth, `${username}@${STUDENT_EMAIL_DOMAIN}`, password); }
  catch (error) { errorEl.textContent = authMessage(error); }
}

async function handleTeacherLogin(event) {
  event.preventDefault();
  el("teacher-login-error").textContent = "";
  try { await signInWithPopup(auth, googleProvider); }
  catch (error) { el("teacher-login-error").textContent = authMessage(error); }
}

function bindUi() {
  bindTabs();
  document.querySelectorAll("[data-login-tab]").forEach(button => button.addEventListener("click", () => setLoginTab(button.dataset.loginTab)));
  el("student-login-form").addEventListener("submit", handleStudentLogin);
  el("teacher-login-form").addEventListener("submit", handleTeacherLogin);
  el("logout-button").addEventListener("click", () => signOut(auth));
  el("release-toggle").addEventListener("click", toggleRelease);
  el("student-search").addEventListener("input", event => { state.query = event.target.value; renderStudentList(); });
  el("edit-profile-button").addEventListener("click", openEditProfile);
  el("edit-profile-form").addEventListener("submit", handleEditProfile);
  el("close-report-detail").addEventListener("click", () => el("report-detail-dialog").close());
  el("done-report-detail").addEventListener("click", () => el("report-detail-dialog").close());
  el("delete-attempt-button").addEventListener("click", deleteSelectedAttempt);
}

function stopListeners() {
  state.unsubscribeReports?.(); state.unsubscribeRelease?.(); state.unsubscribeProfiles?.(); state.unsubscribeSessions?.();
  state.unsubscribeReports = null; state.unsubscribeRelease = null; state.unsubscribeProfiles = null; state.unsubscribeSessions = null;
  clearInterval(state.dashboardTicker); state.dashboardTicker = null;
}

function showLogin() {
  stopListeners();
  state.session = null; state.role = null; state.reports = []; state.sessions = []; state.userProfiles.clear();
  document.body.classList.remove("student-mode", "teacher-mode");
  el("app-shell").hidden = true;
  el("login-shell").hidden = false;
  history.replaceState(null, "", location.pathname);
}

function startListeners(user) {
  stopListeners();
  const reportsRef = collection(db, "reports");
  const reportsQuery = state.role === "teacher" ? reportsRef : query(reportsRef, where("uid", "==", user.uid));
  state.unsubscribeReports = onSnapshot(reportsQuery, snapshot => {
    state.reports = snapshot.docs.map(reportDoc => {
      const data = reportDoc.data();
      return { id: reportDoc.id, ...data, submittedAt: timestampToIso(data.submittedAt) };
    });
    setSyncStatus("Synced with Firebase", true);
    renderProfile();
  }, error => { console.error(error); setSyncStatus("Firebase connection lost", false); });

  const sessionsRef = collection(db, "testSessions");
  const sessionsQuery = state.role === "teacher" ? sessionsRef : query(sessionsRef, where("uid", "==", user.uid));
  state.unsubscribeSessions = onSnapshot(sessionsQuery, snapshot => {
    state.sessions = snapshot.docs.map(sessionDoc => ({ id: sessionDoc.id, ...sessionDoc.data() }));
    renderProfile();
  }, error => console.error("Test session error", error));

  if (state.role === "teacher") {
    state.unsubscribeProfiles = onSnapshot(collection(db, "users"), snapshot => {
      state.userProfiles = new Map(snapshot.docs.map(profileDoc => {
        const data = profileDoc.data();
        return [data.studentId, { uid: profileDoc.id, ...data }];
      }).filter(([studentId, profile]) => studentId && profile.role === "student"));
      refreshStudents();
    }, error => console.error("Student profile error", error));
  }

  state.unsubscribeRelease = onSnapshot(doc(db, "testReleases", FEATURED_TEST_ID), snapshot => {
    state.release = snapshot.exists() ? snapshot.data() : { released: false };
    renderReleaseControl();
  }, error => console.error("Release status error", error));

  state.dashboardTicker = setInterval(() => {
    if (state.selectedStudentId) renderProctorStatus(state.selectedStudentId);
  }, 1000);
}

function openApp(user, session) {
  state.session = { ...session, uid: user.uid };
  state.role = session.role;
  document.body.classList.toggle("student-mode", session.role === "student");
  document.body.classList.toggle("teacher-mode", session.role === "teacher");
  el("login-shell").hidden = true;
  el("app-shell").hidden = false;
  if (session.role === "student") {
    state.userProfiles.set(session.studentId, { uid: user.uid, ...session.profile });
    state.selectedStudentId = session.studentId;
    const base = state.allStudents.find(item => item.id === session.studentId);
    if (!base) throw new Error("The student profile does not exist.");
    el("session-label").textContent = session.profile.nickname || base.nickname || session.profile.fullName || base.fullName;
  } else {
    const requestedId = new URLSearchParams(location.hash.replace(/^#/, "")).get("student");
    state.selectedStudentId = state.allStudents.some(student => student.id === requestedId) ? requestedId : state.allStudents[0]?.id || null;
    el("session-label").textContent = "Teacher: Mr. Hà Chí Thanh";
  }
  refreshStudents();
  renderReleaseControl();
  el("loading-state").hidden = true;
  el("profile-content").hidden = false;
  startListeners(user);
}

async function resolveSession(user) {
  if (user.email?.toLowerCase() === TEACHER_EMAIL) return { role: "teacher" };
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  if (!profileSnapshot.exists()) throw new Error("This account is not linked to a student profile.");
  const profile = profileSnapshot.data();
  if (profile.role !== "student" || !state.allStudents.some(student => student.id === profile.studentId)) throw new Error("The student profile is not valid.");
  return { role: "student", studentId: profile.studentId, profile };
}

async function recordReport(payload) {
  if (state.role !== "student" || !state.session?.studentId || !auth.currentUser) throw new Error("A student must sign in before submitting a test.");
  const report = { uid: auth.currentUser.uid, studentId: state.session.studentId, testId: String(payload.testId || ""), score: Number(payload.score), maxScore: Number(payload.maxScore), durationSeconds: Number(payload.durationSeconds || 0), submittedAt: payload.submittedAt || new Date().toISOString(), createdAt: serverTimestamp(), details: payload.details || null };
  if (!validReport(report)) throw new Error("The report data is not valid.");
  const result = await addDoc(collection(db, "reports"), report);
  return { id: result.id, ...report };
}

window.PISTracker = Object.freeze({ recordReport, currentStudentId: () => state.session?.studentId || null });

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json();
}

async function init() {
  bindUi();
  try {
    const [studentData, testData] = await Promise.all([loadJson(DATA_URLS.students), loadJson(DATA_URLS.tests)]);
    state.allStudents = [...studentData.students].sort((a, b) => collator.compare(a.fullName, b.fullName));
    state.tests = testData.tests || [];
    onAuthStateChanged(auth, async user => {
      if (!user) return showLogin();
      try { openApp(user, await resolveSession(user)); }
      catch (error) { console.error(error); await signOut(auth); el("student-login-error").textContent = error.message; }
    });
  } catch (error) {
    console.error(error);
    el("login-shell").hidden = true; el("app-shell").hidden = false;
    el("loading-state").hidden = true; el("error-state").hidden = false;
  }
}

init();
