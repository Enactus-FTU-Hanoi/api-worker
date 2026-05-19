-- api-worker/migrations/seed.sql
-- Insert admin account (password: admin123)
-- Password hash được tạo bằng PBKDF2 với salt và iterations
INSERT OR IGNORE INTO members (id, generation, department, name, email, role, status, password_hash, photo) 
VALUES (
  'admin-1', 
  'K0', 
  'Ban Điều Hành', 
  'Admin Enactus', 
  'admin@enactus.com', 
  'Super Admin', 
  'ACTIVE',
  'temp',
  'https://ui-avatars.com/api/?name=Admin&background=FFC107&color=fff'
);

-- Insert sample members
INSERT OR IGNORE INTO members (id, generation, department, name, email, role, status, photo, phone) 
VALUES 
  ('member-1', 'K12', 'Project', 'Nguyễn Văn A', 'a.nguyen@enactus.com', 'Member', 'ACTIVE', 'https://ui-avatars.com/api/?name=Nguyễn+Văn+A&background=FFC107&color=fff', '0912345678'),
  ('member-2', 'K12', 'Marketing', 'Trần Thị B', 'b.tran@enactus.com', 'Member', 'ACTIVE', 'https://ui-avatars.com/api/?name=Trần+Thị+B&background=FFC107&color=fff', '0912345679'),
  ('member-3', 'K11', 'HR', 'Lê Văn C', 'c.le@enactus.com', 'Admin', 'ACTIVE', 'https://ui-avatars.com/api/?name=Lê+Văn+C&background=FFC107&color=fff', '0912345680');