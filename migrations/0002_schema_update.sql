-- Migration 0002: Updated schema with new member fields + forms + badges
-- Updated member fields, badges system, and forms system for Enactus FTU Hanoi

-- ─── UPDATE members table ────────────────────────────────────────────────────
ALTER TABLE members ADD COLUMN generation TEXT;
ALTER TABLE members ADD COLUMN photo_url TEXT;
ALTER TABLE members ADD COLUMN dob TEXT;
ALTER TABLE members ADD COLUMN facebook_url TEXT;
ALTER TABLE members ADD COLUMN linkedin_url TEXT;
ALTER TABLE members ADD COLUMN bio TEXT;

-- ─── BADGES ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#FFC107',
  criteria    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_badges (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  badge_id   TEXT NOT NULL REFERENCES badges(id),
  awarded_by TEXT REFERENCES members(id),
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  note       TEXT,
  UNIQUE(member_id, badge_id)
);

-- ─── FORMS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forms (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  fields       TEXT NOT NULL,
  access       TEXT NOT NULL DEFAULT 'all',
  created_by   TEXT NOT NULL REFERENCES members(id),
  deadline     TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'draft')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS form_responses (
  id          TEXT PRIMARY KEY,
  form_id     TEXT NOT NULL REFERENCES forms(id),
  member_id   TEXT NOT NULL REFERENCES members(id),
  answers     TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(form_id, member_id)
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_member_badges_member ON member_badges(member_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_form  ON form_responses(form_id);
CREATE INDEX IF NOT EXISTS idx_forms_status         ON forms(status, created_at);

-- ─── SEED BADGES ─────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO badges (id, name, description, icon, color, criteria) VALUES
  ('badge-001', 'Thành viên mới',    'Chào mừng gia nhập CLB',           '🌱', '#22C55E', '{"type":"manual"}'),
  ('badge-002', 'Chuyên cần',        'Hoàn thành 10 task liên tiếp',      '⚡', '#FFC107', '{"type":"task","threshold":10}'),
  ('badge-003', 'Ngôi sao KPI',      'Đạt 100 điểm KPI trong 1 kỳ',      '⭐', '#F59E0B', '{"type":"score","threshold":100}'),
  ('badge-004', 'Đóng góp xuất sắc', 'Top 3 điểm KPI toàn CLB',          '🏆', '#EF4444', '{"type":"manual"}'),
  ('badge-005', 'Nhà tổ chức',       'Tổ chức thành công 1 sự kiện',      '🎯', '#8B5CF6', '{"type":"manual"}'),
  ('badge-006', 'Mentor',            'Hỗ trợ và hướng dẫn thành viên mới','🎓', '#06B6D4', '{"type":"manual"}');
