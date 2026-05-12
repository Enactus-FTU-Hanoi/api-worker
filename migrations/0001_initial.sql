-- Migration 001: Initial schema for Enactus FTU Hanoi system

-- Members
CREATE TABLE IF NOT EXISTS members (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin', 'super_admin')),
  avatar_url   TEXT,
  department   TEXT,
  position     TEXT,
  phone        TEXT,
  student_id   TEXT UNIQUE,
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
  updated_at   TEXT
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  assigned_to TEXT NOT NULL REFERENCES members(id),
  created_by  TEXT NOT NULL REFERENCES members(id),
  due_date    TEXT,
  project     TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  points      INTEGER NOT NULL DEFAULT 10,
  status      TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done', 'cancelled')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

-- Scores / KPI
CREATE TABLE IF NOT EXISTS scores (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  category   TEXT NOT NULL DEFAULT 'general',
  score      REAL NOT NULL,
  period     TEXT NOT NULL,  -- e.g. '2024-Q1', '2024-10'
  note       TEXT,
  graded_by  TEXT REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schedule polls
CREATE TABLE IF NOT EXISTS schedule_polls (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  time_slots  TEXT NOT NULL,  -- JSON array of slot strings
  deadline    TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schedule votes
CREATE TABLE IF NOT EXISTS schedule_votes (
  poll_id          TEXT NOT NULL REFERENCES schedule_polls(id),
  member_id        TEXT NOT NULL REFERENCES members(id),
  available_slots  TEXT NOT NULL,  -- JSON array of selected slots
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (poll_id, member_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  member_id  TEXT REFERENCES members(id),  -- NULL = broadcast to all
  type       TEXT NOT NULL DEFAULT 'info' CHECK(type IN ('info', 'warning', 'success', 'task', 'score')),
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- C&B Records
CREATE TABLE IF NOT EXISTS cnb_records (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  period     TEXT NOT NULL,  -- e.g. '2024-Q1'
  type       TEXT NOT NULL CHECK(type IN ('benefit', 'deduction')),
  amount     REAL NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_assigned   ON tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_scores_member    ON scores(member_id, period);
CREATE INDEX IF NOT EXISTS idx_notifs_member    ON notifications(member_id, read);
CREATE INDEX IF NOT EXISTS idx_cnb_member       ON cnb_records(member_id, period);
CREATE INDEX IF NOT EXISTS idx_members_email    ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_dept     ON members(department, status);
