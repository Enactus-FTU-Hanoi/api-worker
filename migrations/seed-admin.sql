-- Seed super admin user for Enactus FTU API

INSERT INTO members (id, name, email, password_hash, role, joined_at, status)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Super Admin',
   'superadmin@enactusftuhanoi.id.vn',
   'Itl/+URQZVzj8XsUguVwOw==:W1L2Javkinnvh/i9i1F7Q2TKLRHjDYBwDEDj6sSzmn8=',
   'super_admin',
   datetime('now'),
   'active');
