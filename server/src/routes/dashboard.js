'use strict';
const express = require('express');
const { db, getSetting, todayISO } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isDirector, isAdmin, isTutor } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

async function studentsPerMonth() {
  return (await db.prepare(
    `SELECT substr(created_at,1,7) AS month, COUNT(*) AS n FROM students GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all()).reverse();
}

router.get('/', asyncHandler(async (req, res) => {
  const base = { appName: await getSetting('nama_lembaga', 'Bimbel Rumah Pintar') };

  if (isTutor(req.user)) {
    const tid = req.user.tutorId;
    const today = todayISO();
    const dow = new Date(today + 'T00:00:00').getDay();
    const myClasses = await db.prepare(
      `SELECT c.*, sub.name AS subject_name,
        (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id AND cs.status='aktif') AS student_count
       FROM classes c LEFT JOIN subjects sub ON sub.id=c.subject_id WHERE c.tutor_id=? AND c.status='aktif'`
    ).all(tid);
    const todaySchedules = await db.prepare(
      `SELECT s.*, c.name AS class_name, sub.name AS subject_name FROM schedules s
       JOIN classes c ON c.id=s.class_id LEFT JOIN subjects sub ON sub.id=c.subject_id
       WHERE s.tutor_id=? AND s.day_of_week=? AND s.status='aktif' ORDER BY s.start_time`
    ).all(tid, dow);
    const todaySessions = await db.prepare(
      `SELECT cs.*, c.name AS class_name,
        (SELECT COUNT(*) FROM student_attendances a WHERE a.session_id=cs.id) AS filled,
        (SELECT COUNT(*) FROM class_students x WHERE x.class_id=cs.class_id AND x.status='aktif') AS total,
        (SELECT COUNT(*) FROM teaching_journals j WHERE j.session_id=cs.id) AS has_journal
       FROM class_sessions cs JOIN classes c ON c.id=cs.class_id
       WHERE cs.tutor_id=? AND cs.session_date=? ORDER BY cs.start_time`
    ).all(tid, today);
    const pendingJournals = (await db.prepare(
      `SELECT COUNT(*) AS n FROM class_sessions cs WHERE cs.tutor_id=? AND cs.session_date<=?
        AND cs.status IN ('selesai','terjadwal') AND NOT EXISTS (SELECT 1 FROM teaching_journals j WHERE j.session_id=cs.id)`
    ).get(tid, today)).n;
    const myStudents = (await db.prepare(
      `SELECT COUNT(DISTINCT cs.student_id) AS n FROM class_students cs JOIN classes c ON c.id=cs.class_id
       WHERE c.tutor_id=? AND cs.status='aktif'`
    ).get(tid)).n;
    const myReports = await db.prepare(
      `SELECT status, COUNT(*) AS n FROM student_reports WHERE tutor_id=? GROUP BY status`
    ).all(tid);
    const recentStudents = await db.prepare(
      `SELECT DISTINCT s.id, s.nis, s.full_name, s.school_grade FROM students s
       JOIN class_students cs ON cs.student_id=s.id JOIN classes c ON c.id=cs.class_id
       WHERE c.tutor_id=? AND cs.status='aktif' ORDER BY s.full_name LIMIT 8`
    ).all(tid);
    const recentEvaluations = await db.prepare(
      `SELECT a.updated_at, a.period_label, a.final_score, s.full_name AS student_name, sub.name AS subject_name
       FROM assessments a JOIN students s ON s.id=a.student_id JOIN subjects sub ON sub.id=a.subject_id
       WHERE a.student_id IN (SELECT DISTINCT cs.student_id FROM class_students cs JOIN classes c ON c.id=cs.class_id WHERE c.tutor_id=?)
       ORDER BY a.updated_at DESC LIMIT 6`
    ).all(tid);
    return res.json({
      data: {
        ...base, role: 'tentor',
        todaySchedules: todaySchedules.map((s) => ({ ...s, className: s.class_name, subjectName: s.subject_name, dayName: HARI[s.day_of_week] })),
        todaySessions,
        myClasses,
        totalStudents: myStudents,
        pendingJournals,
        reportsByStatus: myReports,
        recentStudents,
        recentEvaluations,
      },
    });
  }

  // Direktur & sekretaris
  const activeStudents = (await db.prepare(`SELECT COUNT(*) AS n FROM students WHERE status='aktif'`).get()).n;
  const newStudents = (await db.prepare(`SELECT COUNT(*) AS n FROM students WHERE start_date >= date('now','start of month','-7 hours')`).get()).n;
  const activeTutors = (await db.prepare(`SELECT COUNT(*) AS n FROM tutors WHERE status='aktif'`).get()).n;
  const activeClasses = (await db.prepare(`SELECT COUNT(*) AS n FROM classes WHERE status='aktif'`).get()).n;
  const unpaid = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total-paid),0) AS total FROM invoices WHERE status IN ('belum','sebagian','jatuh_tempo')`).get();
  const income = (await db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='posted'`).get()).total;
  const attToday = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN a.status='hadir' THEN 1 ELSE 0 END),0) AS hadir,
            COALESCE(SUM(CASE WHEN a.status!='hadir' THEN 1 ELSE 0 END),0) AS tidak,
            COUNT(*) AS total
     FROM student_attendances a JOIN class_sessions cs ON cs.id=a.session_id WHERE cs.session_date=?`
  ).get(todayISO());
  const tutorAttMonth = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status='hadir' THEN 1 ELSE 0 END),0) AS hadir, COUNT(*) AS total
     FROM tutor_attendances WHERE substr(att_date,1,7)=substr(?,1,7)`
  ).get(todayISO());
  const pendingReports = await db.prepare(
    `SELECT rp.id, rp.report_code, rp.status, s.full_name AS student_name, p.name AS period_name
     FROM student_reports rp JOIN students s ON s.id=rp.student_id JOIN report_periods p ON p.id=rp.period_id
     WHERE rp.status IN ('draf','menunggu','revisi','disetujui') ORDER BY rp.updated_at DESC LIMIT 10`
  ).all();
  const incomeMonthly = (await db.prepare(
    `SELECT substr(paid_at,1,7) AS month, SUM(amount) AS total FROM payments WHERE status='posted' GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all()).reverse();
  const latestActivities = await db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 12').all();
  const incompleteDocs = (await db.prepare(
    `SELECT COUNT(*) AS n FROM students WHERE status='aktif' AND (school_name IS NULL OR school_name='' OR address IS NULL OR address='')`
  ).get()).n;
  const recentPayments = await db.prepare(
    `SELECT p.transaction_number, p.amount, p.method, p.paid_at, s.full_name AS student_name
     FROM payments p JOIN students s ON s.id=p.student_id WHERE p.status='posted' ORDER BY p.id DESC LIMIT 6`
  ).all();
  const upcomingSessions = await db.prepare(
    `SELECT cs.*, c.name AS class_name, t.full_name AS tutor_name FROM class_sessions cs
     JOIN classes c ON c.id=cs.class_id JOIN tutors t ON t.id=cs.tutor_id
     WHERE cs.session_date >= ? ORDER BY cs.session_date, cs.start_time LIMIT 8`
  ).all(todayISO());
  const development = await db.prepare(
    `SELECT s.full_name, AVG(a.final_score) AS avg_score FROM assessments a JOIN students s ON s.id=a.student_id
     GROUP BY s.id HAVING avg_score IS NOT NULL ORDER BY avg_score DESC LIMIT 8`
  ).all();

  res.json({
    data: {
      ...base,
      role: req.user.role,
      activeStudents, newStudents, activeTutors, activeClasses,
      unpaidCount: unpaid.n, unpaidTotal: unpaid.total, totalIncome: income,
      attendanceToday: attToday,
      tutorAttendanceMonth: tutorAttMonth,
      pendingReports, incomeMonthly, latestActivities, incompleteDocs,
      recentPayments, upcomingSessions, studentsPerMonth: await studentsPerMonth(), development,
    },
  });
}));

module.exports = router;
